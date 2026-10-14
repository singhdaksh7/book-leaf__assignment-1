import { createHash } from "node:crypto";
import express, { Router, type Response } from "express";
import { bookListResponseSchema, createTicketSchema, ticketDetailResponseSchema, ticketFilterSchema, ticketListResponseSchema, ticketResponseSchema } from "@bookleaf/contracts";
import type { PrismaClient } from "@bookleaf/db";
import { authorProfileId, requireAuthor } from "../auth/middleware.js";
import { FailureLimiter } from "../auth/rateLimit.js";
import { allowedAttachmentTypes, contentDisposition, validateUpload } from "../attachments/validate.js";
import { newStorageKey, type AttachmentStorage } from "../attachments/storage.js";
import type { AiAttemptService } from "../ai/attempts.js";
import type { TicketEventHub } from "../events/hub.js";
import type { AppConfig } from "../config.js";
import { AppError, notFound } from "../http/errors.js";
import type { Logger } from "../http/logger.js";
import { asyncHandler, parseInput } from "../http/validate.js";
import { serializeBook } from "../serializers.js";
import { filterWhere, parseTicketFilter } from "../tickets/filters.js";
import type { TicketHooks } from "../tickets/hooks.js";
import { attachmentListResponseSchema, attachmentResponseSchema, serializeAttachment, serializeAuthorMessage, serializeTicket, serializeTicketSummary } from "../tickets/serializers.js";

/** Book requests accept pagination only; unknown query keys are rejected rather than silently ignored. */
const bookQuerySchema = ticketFilterSchema.pick({ page: true, pageSize: true }).strict();

export interface AuthorRouterOptions {
  prisma: PrismaClient;
  config: AppConfig;
  storage: AttachmentStorage;
  logger: Logger;
  hooks?: TicketHooks;
  events: TicketEventHub;
  /** Present only when analysis should start automatically for new tickets. */
  ai?: AiAttemptService;
}

export async function sendAttachment(res: Response, storage: AttachmentStorage, attachment: { storageKey: string; fileName: string; contentType: string; sizeBytes: number }): Promise<void> {
  const data = await storage.get(attachment.storageKey);
  if (!data) throw notFound("Attachment not found");
  res.status(200);
  res.setHeader("Content-Type", attachment.contentType);
  res.setHeader("Content-Length", String(data.length));
  res.setHeader("Content-Disposition", contentDisposition(attachment.fileName));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.end(data);
}

export function createAuthorRouter({ prisma, config, storage, logger, hooks, events, ai }: AuthorRouterOptions): Router {
  const router = Router();
  router.use(requireAuthor);
  // Per-user creation throttle (in-memory, per process): counts successful creations in a rolling hour.
  const createLimiter = new FailureLimiter(config.ticketCreateLimitPerHour, 3_600_000);

  router.get("/books", asyncHandler(async (req, res) => {
    const { page, pageSize } = parseInput(bookQuerySchema, req.query, "query");
    // The authenticated profile id is the only scope; no client-supplied author id exists on this route.
    const where = { authorId: authorProfileId(req) };
    const [total, books] = await Promise.all([
      prisma.book.count({ where }),
      prisma.book.findMany({ where, orderBy: [{ externalBookId: "asc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize })
    ]);
    res.status(200).json(bookListResponseSchema.parse({ items: books.map(serializeBook), page, pageSize, total }));
  }));

  router.post("/tickets", asyncHandler(async (req, res) => {
    const authorId = authorProfileId(req);
    const input = parseInput(createTicketSchema, req.body, "ticket");
    const limiterKey = `create:${req.auth!.user.id}`;
    const retryAfter = createLimiter.retryAfterSeconds(limiterKey);
    if (retryAfter > 0) throw new AppError("RATE_LIMITED", "Too many tickets created recently. Try again later.", undefined, { "Retry-After": String(retryAfter) });

    // Ownership is checked inside the same transaction as the insert, holding a share lock on the book row so it cannot be
    // deleted or reassigned in between. A database trigger enforces the same rule as a last line of defence.
    const { ticket, attemptId } = await prisma.$transaction(async (tx) => {
      if (input.bookId !== null) {
        const owned = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Book" WHERE "id" = ${input.bookId} AND "authorId" = ${authorId} FOR SHARE`;
        // Same answer for "does not exist" and "belongs to someone else": existence is not revealed.
        if (owned.length === 0) throw notFound("Book not found");
      }
      const created = await tx.ticket.create({ data: { authorId, bookId: input.bookId, subject: input.subject, description: input.description } });
      // The PENDING attempt commits with the ticket, so a crash can never leave a ticket whose analysis is silently lost.
      const attempt = ai ? await ai.enqueue(tx, created.id) : null;
      return { ticket: created, attemptId: attempt?.attempt.id ?? null };
    });
    createLimiter.recordFailure(limiterKey);

    // After commit: nothing below can fail the request.
    events.publish({ name: "ticket.created", ticketId: ticket.id, authorProfileId: authorId, audience: "all", occurredAt: ticket.updatedAt, version: ticket.updatedAt.toISOString() });
    if (ai && attemptId) ai.kick(attemptId);

    // AI (or anything else) runs after commit and can never fail the request.
    void Promise.resolve().then(() => hooks?.onTicketCreated?.({ id: ticket.id, authorId })).catch((error: unknown) => {
      logger.log("warn", "ticket created hook failed", { requestId: req.requestId, errorName: error instanceof Error ? error.name : "unknown" });
    });

    res.status(201).json(ticketResponseSchema.parse({ ticket: serializeTicket(ticket) }));
  }));

  router.get("/tickets", asyncHandler(async (req, res) => {
    const filter = parseTicketFilter(req);
    // Tenant scope is applied last and from the session only; filters cannot override it.
    const where = { ...filterWhere(filter), authorId: authorProfileId(req) };
    const [total, tickets] = await Promise.all([
      prisma.ticket.count({ where }),
      prisma.ticket.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (filter.page - 1) * filter.pageSize, take: filter.pageSize })
    ]);
    res.status(200).json(ticketListResponseSchema.parse({ items: tickets.map(serializeTicketSummary), page: filter.page, pageSize: filter.pageSize, total }));
  }));

  router.get("/tickets/:ticketId", asyncHandler(async (req, res) => {
    const ticket = await prisma.ticket.findFirst({ where: { id: req.params.ticketId, authorId: authorProfileId(req) } });
    if (!ticket) throw notFound("Ticket not found"); // identical for missing and foreign tickets
    // Only AUTHOR-visible messages are queried; internal notes are never loaded on author routes.
    const messages = await prisma.ticketMessage.findMany({ where: { ticketId: ticket.id, visibility: "AUTHOR" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    res.status(200).json(ticketDetailResponseSchema.parse({ ticket: serializeTicket(ticket), messages: messages.map(serializeAuthorMessage) }));
  }));

  // --- Attachments (not in the frozen contract; proposal reported to the controller) ---
  // Raw body upload: Content-Type is the declared file type, `?filename=` the display name. Auth + CSRF run before the body is read.
  router.post("/tickets/:ticketId/attachments", express.raw({ type: [...allowedAttachmentTypes], limit: config.attachmentMaxBytes }), asyncHandler(async (req, res) => {
    const authorId = authorProfileId(req);
    const ticketId = req.params.ticketId as string;
    const ticket = await prisma.ticket.findFirst({ where: { id: ticketId, authorId }, select: { id: true, status: true } });
    if (!ticket) throw notFound("Ticket not found");
    if (ticket.status === "CLOSED") throw new AppError("CONFLICT", "Closed tickets cannot receive attachments");

    const upload = validateUpload({ body: req.body, contentTypeHeader: req.headers["content-type"], filename: req.query.filename, maxBytes: config.attachmentMaxBytes });
    const storageKey = newStorageKey();
    await storage.put(storageKey, upload.data);
    try {
      const row = await prisma.$transaction(async (tx) => {
        // Lock the ticket row so concurrent uploads cannot exceed the per-ticket limit.
        const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Ticket" WHERE "id" = ${ticketId} AND "authorId" = ${authorId} FOR UPDATE`;
        if (locked.length === 0) throw notFound("Ticket not found");
        if ((await tx.ticketAttachment.count({ where: { ticketId } })) >= config.attachmentMaxPerTicket) {
          throw new AppError("CONFLICT", `A ticket can have at most ${config.attachmentMaxPerTicket} attachments`);
        }
        return tx.ticketAttachment.create({
          data: {
            ticketId, uploaderId: req.auth!.user.id, fileName: upload.fileName, contentType: upload.contentType, sizeBytes: upload.data.length,
            storageKey, sha256: createHash("sha256").update(upload.data).digest("hex")
          }
        });
      });
      res.status(201).json(attachmentResponseSchema.parse({ attachment: serializeAttachment(row) }));
    } catch (error) {
      await storage.delete(storageKey).catch(() => undefined); // no orphaned files when the row was not stored
      throw error;
    }
  }));

  router.get("/tickets/:ticketId/attachments", asyncHandler(async (req, res) => {
    const ticket = await prisma.ticket.findFirst({ where: { id: req.params.ticketId, authorId: authorProfileId(req) }, select: { id: true } });
    if (!ticket) throw notFound("Ticket not found");
    const rows = await prisma.ticketAttachment.findMany({ where: { ticketId: ticket.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    res.status(200).json(attachmentListResponseSchema.parse({ items: rows.map(serializeAttachment) }));
  }));

  router.get("/tickets/:ticketId/attachments/:attachmentId", asyncHandler(async (req, res) => {
    // Ownership is part of the lookup: the attachment must belong to this ticket AND the ticket to this author.
    const attachment = await prisma.ticketAttachment.findFirst({
      where: { id: req.params.attachmentId, ticketId: req.params.ticketId, ticket: { authorId: authorProfileId(req) } }
    });
    if (!attachment) throw notFound("Attachment not found");
    await sendAttachment(res, storage, attachment);
  }));

  return router;
}
