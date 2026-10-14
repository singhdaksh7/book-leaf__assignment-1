import { Router } from "express";
import type { PrismaClient } from "@bookleaf/db";
import { requireAuth } from "../auth/middleware.js";
import { AppError, forbidden } from "../http/errors.js";
import { asyncHandler } from "../http/validate.js";
import { formatSse, type TicketEvent, type TicketEventHub } from "../events/hub.js";

export interface EventsRouterOptions {
  prisma: PrismaClient;
  hub: TicketEventHub;
  /** Keep-alive and session re-validation period. */
  heartbeatMs?: number;
  maxConnectionsPerUser?: number;
  /** Upper bound on tickets replayed after a reconnect. */
  catchUpLimit?: number;
}

const lastEventIdPattern = /^(\d{10,15})-\d{1,7}$/;
const MAX_BUFFERED_BYTES = 1_000_000;

/**
 * GET /events/tickets: Server-Sent Events.
 *
 * Authorisation: the session cookie authenticates the stream; each event is filtered by role and ticket ownership (hub.canReceive)
 * and AI/internal-note events are admin-only. Payloads contain only ticketId, occurredAt and version.
 *
 * Reconnects: browsers resend `Last-Event-ID` (`<epoch-ms>-<n>`). Instead of replaying a server-side buffer, the server derives a
 * `ticket.updated` event for every in-scope ticket whose `updatedAt` is at or after that time. Delivery is therefore at-least-once:
 * clients must treat (ticketId, version) as the idempotency key. Anything the stream cannot carry is available from the
 * polling endpoints (list/detail, every 20-30 s) as documented.
 */
export function createEventsRouter({ prisma, hub, heartbeatMs = 25_000, maxConnectionsPerUser = 5, catchUpLimit = 200 }: EventsRouterOptions): Router {
  const router = Router();

  router.get("/tickets", requireAuth, asyncHandler(async (req, res) => {
    const auth = req.auth!;
    const authorProfileId = auth.user.role === "AUTHOR" ? (auth.authorProfile?.id ?? null) : null;
    if (auth.user.role === "AUTHOR" && !authorProfileId) throw forbidden();
    if (hub.connectionsFor(auth.user.id) >= maxConnectionsPerUser) throw new AppError("RATE_LIMITED", "Too many open event streams", undefined, { "Retry-After": "30" });

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    res.write("retry: 5000\n: connected\n\n");

    let closed = false;
    let ready = false;
    const backlog: TicketEvent[] = [];
    const send = (id: string, event: Pick<TicketEvent, "name" | "ticketId" | "occurredAt" | "version">) => {
      if (closed) return;
      res.write(formatSse(id, event));
      // A client that stops reading must not make the server buffer without bound.
      if (res.writableLength > MAX_BUFFERED_BYTES) close();
    };
    const deliverLive = (event: TicketEvent) => send(hub.nextEventId(event.occurredAt), event);

    let unsubscribe = () => {};
    let timer: NodeJS.Timeout | undefined;
    function close(): void {
      if (closed) return;
      closed = true;
      unsubscribe();
      if (timer) clearInterval(timer);
      res.end();
    }

    // Subscribe before the catch-up query so nothing published in between is lost; live events wait in `backlog`.
    unsubscribe = hub.subscribe({
      userId: auth.user.id, role: auth.user.role, authorProfileId, sessionId: auth.sessionId,
      deliver: (event) => (ready ? deliverLive(event) : void backlog.push(event)),
      close
    });
    req.on("close", close);

    timer = setInterval(() => {
      void (async () => {
        if (closed) return;
        // Close when the session expires or was revoked (logout elsewhere, expiry).
        const session = auth.expiresAt.getTime() > Date.now() ? await prisma.session.findUnique({ where: { id: auth.sessionId }, select: { expiresAt: true } }).catch(() => undefined) : null;
        if (session === null || (session && session.expiresAt.getTime() <= Date.now())) return close();
        if (!closed) res.write(": ping\n\n");
      })();
    }, heartbeatMs);
    timer.unref();

    const header = req.headers["last-event-id"];
    const lastEventId = typeof header === "string" ? header : typeof req.query.lastEventId === "string" ? req.query.lastEventId : undefined;
    const match = lastEventId ? lastEventIdPattern.exec(lastEventId) : null;
    try {
      const since = match ? new Date(Number(match[1])) : null;
      if (since && !Number.isNaN(since.getTime())) {
        const tickets = await prisma.ticket.findMany({
          where: { updatedAt: { gte: since }, ...(authorProfileId ? { authorId: authorProfileId } : {}) },
          orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: catchUpLimit, select: { id: true, updatedAt: true }
        });
        // More changes than one replay can carry: tell the client (a comment, invisible to EventSource listeners) so it refetches.
        if (tickets.length >= catchUpLimit) res.write(": catch-up truncated; refetch ticket lists\n\n");
        for (const ticket of tickets) send(`${ticket.updatedAt.getTime()}-0`, { name: "ticket.updated", ticketId: ticket.id, occurredAt: ticket.updatedAt, version: ticket.updatedAt.toISOString() });
      }
    } catch {
      // Headers are already sent, so an error body is impossible; closing makes the client reconnect or fall back to polling.
      return close();
    }
    ready = true;
    for (const event of backlog.splice(0)) deliverLive(event);
  }));

  return router;
}
