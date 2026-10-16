import type { Response } from "express";
import type { UserRole } from "@bookleaf/db";

export const ticketEventNames = ["ticket.created", "ticket.updated", "ticket.reply.created", "ticket.analysis.updated"] as const;
export type TicketEventName = (typeof ticketEventNames)[number];

/** Server-side event. Only `ticketId`, `occurredAt` and `version` ever reach a client; the rest drives authorisation. */
export interface TicketEvent {
  name: TicketEventName;
  ticketId: string;
  /** AuthorProfile id that owns the ticket: the tenant key used to filter delivery. */
  authorProfileId: string;
  /** "admin" events (internal notes, AI analysis) are never delivered to authors. */
  audience: "all" | "admin";
  occurredAt: Date;
  /** Safe minimal resource version (ISO timestamp); clients compare it to discard stale or duplicate deliveries. */
  version: string;
}

export interface Subscriber {
  userId: string;
  role: UserRole;
  /** AuthorProfile id for authors; null for admins. */
  authorProfileId: string | null;
  sessionId: string;
  deliver(event: TicketEvent): void;
  close(): void;
}

/** Whether `subscriber` may receive `event`. Pure, so it can be tested exhaustively. */
export function canReceive(subscriber: Pick<Subscriber, "role" | "authorProfileId">, event: Pick<TicketEvent, "authorProfileId" | "audience">): boolean {
  if (subscriber.role === "ADMIN") return true;
  return event.audience === "all" && subscriber.authorProfileId !== null && subscriber.authorProfileId === event.authorProfileId;
}

/**
 * In-process fan-out. Live delivery works within one API process; reconnect catch-up is derived from the database
 * (see routes/events.ts), so a restart or a second instance loses live pushes but never state: clients fall back to polling.
 */
export class TicketEventHub {
  private readonly subscribers = new Set<Subscriber>();
  private seq = 0;

  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  connectionsFor(userId: string): number {
    let count = 0;
    for (const s of this.subscribers) if (s.userId === userId) count += 1;
    return count;
  }

  get size(): number {
    return this.subscribers.size;
  }

  nextEventId(at: Date): string {
    this.seq = (this.seq + 1) % 1_000_000;
    return `${at.getTime()}-${this.seq}`;
  }

  /** Never throws: a broken connection must not affect the request that produced the event. */
  publish(event: TicketEvent): void {
    for (const subscriber of [...this.subscribers]) {
      if (!canReceive(subscriber, event)) continue;
      try {
        subscriber.deliver(event);
      } catch {
        this.subscribers.delete(subscriber);
        try { subscriber.close(); } catch { /* already closed */ }
      }
    }
  }

  /** Closes every stream bound to a session (logout). */
  closeSession(sessionId: string): void {
    for (const subscriber of [...this.subscribers]) {
      if (subscriber.sessionId === sessionId) {
        this.subscribers.delete(subscriber);
        subscriber.close();
      }
    }
  }

  closeAll(): void {
    for (const subscriber of [...this.subscribers]) {
      this.subscribers.delete(subscriber);
      subscriber.close();
    }
  }
}

/** SSE wire format for one event. Payload carries exactly ticketId, occurredAt and version. */
export function formatSse(id: string, event: Pick<TicketEvent, "name" | "ticketId" | "occurredAt" | "version">): string {
  const data = JSON.stringify({ ticketId: event.ticketId, occurredAt: event.occurredAt.toISOString(), version: event.version });
  return `id: ${id}\nevent: ${event.name}\ndata: ${data}\n\n`;
}

export const writeSse = (res: Response, chunk: string): boolean => res.write(chunk);
