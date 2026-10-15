import { Router } from "express";
import {
  adminQueueResponseSchema, adminTicketDetailResponseSchema, aiAnalysisRequestResponseSchema, aiAnalysisResponseSchema, assignTicketSchema,
  assignmentResponseSchema, internalNoteResponseSchema, internalNoteSchema, ticketMessageResponseSchema, ticketReplySchema, ticketResponseSchema, updateTicketSchema
} from "@bookleaf/contracts";
import { Prisma, type PrismaClient, type Ticket } from "@bookleaf/db";
import type { AiAttemptService } from "../ai/attempts.js";
import { requireRole } from "../auth/middleware.js";
import type { AttachmentStorage } from "../attachments/storage.js";
import type { TicketEventHub, TicketEventName } from "../events/hub.js";
import { AppError, forbidden, notFound } from "../http/errors.js";
import { asyncHandler, parseInput } from "../http/validate.js";
import { serializeAuthorProfile, serializeBook } from "../serializers.js";
import { filterWhere, parseTicketFilter } from "../tickets/filters.js";
import {
  attachmentListResponseSchema, serializeAiAttempt, serializeAssignment, serializeAuthorMessage, serializeAttachment, serializeAuditEvent, serializeInternalNote,
  serializeMessage, serializeTicket, serializeTicketSummary
} from "../tickets/serializers.js";
import { canTransition } from "../tickets/transitions.js";
import { sendAttachment } from "./author.js";

export interface AdminRouterOptions {
  prisma: PrismaClient;
  storage: AttachmentStorage;
  events: TicketEventHub;
  ai: AiAttemptService;
  /** Identical replies/notes from the same admin within this window are treated as a retry, not a new message. */
  duplicateWindowMs?: number;
}

const unresolvedSql = Prisma.sql`"status" IN ('OPEN', 'IN_PROGRESS')`;

export function createAdminRouter({ prisma, storage, events, ai, duplicateWindowMs = 60_000 }: AdminRouterOptions): Router {
  const router = Router();

  const announce = (name: TicketEventName, ticket: Pick<Ticket, "id" | "authorId" | "updatedAt">, audience: "all" | "admin" = "all") =>
    events.publish({ name, ticketId: ticket.id, authorProfileId: ticket.authorId, audience, occurredAt: ticket.updatedAt, version: ticket.updatedAt.toISOString() });
  /** Moves updatedAt so pollers and SSE catch-up see the change. */
  const touch = (tx: Prisma.TransactionClient, ticketId: string) => tx.ticket.update({ where: { id: ticketId }, data: { updatedAt: new Date() } });
  router.use(requireRole("ADMIN"));

  /**
   * Queue order (stable, total): unresolved tickets first; among them most urgent priority first (enum order
   * CRITICAL..LOW, unclassified last), then oldest first; resolved/closed follow, most recently updated first; id breaks ties.
   */
  router.get("/tickets", asyncHandler(async (req, res) => {
    const filter = parseTicketFilter(req);
    const where = filterWhere(filter);
    const conditions: Prisma.Sql[] = [];
    if (filter.status) conditions.push(Prisma.sql`"status" = ${filter.status}::"TicketStatus"`);
    if (filter.category) conditions.push(Prisma.sql`"category" = ${filter.category}::"TicketCategory"`);
    if (filter.priority) conditions.push(Prisma.sql`"priority" = ${filter.priority}::"TicketPriority"`);
    // Timestamps are stored as UTC without a zone. Convert the bound explicitly so the comparison never depends on the
    // database session time zone.
    if (filter.from) conditions.push(Prisma.sql`"createdAt" >= (${filter.from.toISOString()}::timestamptz AT TIME ZONE 'UTC')`);
    if (filter.to) conditions.push(Prisma.sql`"createdAt" <= (${filter.to.toISOString()}::timestamptz AT TIME ZONE 'UTC')`);
    const whereSql = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;

    const [total, idRows] = await Promise.all([
      prisma.ticket.count({ where }),
      prisma.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Ticket" ${whereSql}
        ORDER BY (CASE WHEN ${unresolvedSql} THEN 0 ELSE 1 END) ASC,
                 (CASE WHEN ${unresolvedSql} THEN "priority" END) ASC NULLS LAST,
                 (CASE WHEN ${unresolvedSql} THEN "createdAt" END) ASC,
                 (CASE WHEN ${unresolvedSql} THEN NULL ELSE "updatedAt" END) DESC,
                 "id" ASC
        LIMIT ${filter.pageSize} OFFSET ${(filter.page - 1) * filter.pageSize}`
    ]);
    const ids = idRows.map((row) => row.id);
    const rows = await prisma.ticket.findMany({ where: { id: { in: ids } } });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const items = ids.flatMap((id) => (byId.has(id) ? [serializeTicketSummary(byId.get(id)!)] : []));
    res.status(200).json(adminQueueResponseSchema.parse({ items, page: filter.page, pageSize: filter.pageSize, total }));
  }));

  router.get("/tickets/:ticketId", asyncHandler(async (req, res) => {
    const ticket = await prisma.ticket.findUnique({ where: { id: req.params.ticketId } });
    if (!ticket) throw notFound("Ticket not found");
    const [author, book, messages, notes, assignments, latestAi, audit] = await Promise.all([
      prisma.authorProfile.findUniqueOrThrow({ where: { id: ticket.authorId } }),
      ticket.bookId ? prisma.book.findUnique({ where: { id: ticket.bookId } }) : Promise.resolve(null),
      prisma.ticketMessage.findMany({ where: { ticketId: ticket.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      prisma.internalNote.findMany({ where: { ticketId: ticket.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      prisma.ticketAssignment.findMany({ where: { ticketId: ticket.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      prisma.aiAnalysis.findFirst({ where: { ticketId: ticket.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
      prisma.auditLog.findMany({ where: { entityType: "Ticket", entityId: ticket.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 })
    ]);
    res.status(200).json(adminTicketDetailResponseSchema.parse({
      ticket: serializeTicket(ticket), author: serializeAuthorProfile(author), book: book ? serializeBook(book) : null,
      messages: messages.map(serializeMessage), internalNotes: notes.map(serializeInternalNote), assignments: assignments.map(serializeAssignment),
      aiAnalysis: latestAi ? serializeAiAttempt(latestAi) : null, auditEvents: audit.reverse().map(serializeAuditEvent)
    }));
  }));

  /** Status, category and priority overrides. State change, validation and audit rows commit together or not at all. */
  router.patch("/tickets/:ticketId", asyncHandler(async (req, res) => {
    const input = parseInput(updateTicketSchema, req.body, "ticket update");
    const ticketId = req.params.ticketId as string;
    const actorId = req.auth!.user.id;

    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Ticket" WHERE "id" = ${ticketId} FOR UPDATE`;
      if (locked.length === 0) throw notFound("Ticket not found");
      const current = await tx.ticket.findUniqueOrThrow({ where: { id: ticketId } });

      const changes: Array<{ field: "status" | "category" | "priority"; before: string | null; after: string }> = [];
      if (input.status !== undefined && input.status !== current.status) {
        if (!canTransition(current.status, input.status)) throw new AppError("CONFLICT", `Cannot change status from ${current.status} to ${input.status}`);
        changes.push({ field: "status", before: current.status, after: input.status });
      }
      if (input.category !== undefined && input.category !== current.category) changes.push({ field: "category", before: current.category, after: input.category });
      if (input.priority !== undefined && input.priority !== current.priority) changes.push({ field: "priority", before: current.priority, after: input.priority });

      if (changes.length === 0) return { ticket: current, changed: false };
      if (current.status === "CLOSED") throw new AppError("CONFLICT", "Closed tickets cannot be modified");

      const ticket = await tx.ticket.update({
        where: { id: ticketId },
        data: Object.fromEntries(changes.map((change) => [change.field, change.after]))
      });
      // One append-only audit row per changed field; values are enum names only, never ticket text.
      await tx.auditLog.createMany({
        data: changes.map((change) => ({
          actorId, action: `ticket.${change.field}.updated`, entityType: "Ticket", entityId: ticketId,
          before: { [change.field]: change.before }, after: { [change.field]: change.after }, requestId: req.requestId
        }))
      });
      return { ticket, changed: true };
    });
    if (result.changed) announce("ticket.updated", result.ticket);
    res.status(200).json(ticketResponseSchema.parse({ ticket: serializeTicket(result.ticket) }));
  }));

  /**
   * Explicit admin send action: the only way a message becomes visible to an author. The body is whatever the admin submits
   * (an AI draft is only ever suggestion data). An identical message from the same admin within the duplicate window is a
   * retry and returns the original message instead of sending twice.
   */
  router.post("/tickets/:ticketId/replies", asyncHandler(async (req, res) => {
    const input = parseInput(ticketReplySchema, req.body, "reply");
    const ticketId = req.params.ticketId as string;
    const actorId = req.auth!.user.id;
    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string; status: string }[]>`SELECT "id", "status" FROM "Ticket" WHERE "id" = ${ticketId} FOR UPDATE`;
      if (!locked[0]) throw notFound("Ticket not found");
      if (locked[0].status === "CLOSED") throw new AppError("CONFLICT", "Closed tickets cannot receive replies");
      const duplicate = await tx.ticketMessage.findFirst({
        where: { ticketId, authorId: actorId, visibility: "AUTHOR", body: input.body, createdAt: { gte: new Date(Date.now() - duplicateWindowMs) } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }]
      });
      if (duplicate) return { message: duplicate, ticket: null };
      const message = await tx.ticketMessage.create({ data: { ticketId, authorId: actorId, body: input.body, visibility: "AUTHOR" } });
      const ticket = await touch(tx, ticketId);
      await tx.auditLog.create({
        data: { actorId, action: "ticket.reply.created", entityType: "Ticket", entityId: ticketId, after: { messageId: message.id, visibility: "AUTHOR" }, requestId: req.requestId }
      });
      return { message, ticket };
    });
    if (result.ticket) announce("ticket.reply.created", result.ticket);
    res.status(201).json(ticketMessageResponseSchema.parse({ message: serializeAuthorMessage(result.message) }));
  }));

  /** Admin-only and immutable. Never loaded by an author route; no author-facing event is emitted. */
  router.post("/tickets/:ticketId/internal-notes", asyncHandler(async (req, res) => {
    const input = parseInput(internalNoteSchema, req.body, "internal note");
    const ticketId = req.params.ticketId as string;
    const actorId = req.auth!.user.id;
    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string; authorId: string }[]>`SELECT "id", "authorId" FROM "Ticket" WHERE "id" = ${ticketId} FOR UPDATE`;
      if (!locked[0]) throw notFound("Ticket not found");
      const duplicate = await tx.internalNote.findFirst({
        where: { ticketId, authorId: actorId, body: input.body, createdAt: { gte: new Date(Date.now() - duplicateWindowMs) } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }]
      });
      if (duplicate) return { note: duplicate, created: false, authorProfileId: locked[0].authorId };
      const note = await tx.internalNote.create({ data: { ticketId, authorId: actorId, body: input.body } });
      await tx.auditLog.create({
        data: { actorId, action: "ticket.internal_note.created", entityType: "Ticket", entityId: ticketId, after: { noteId: note.id }, requestId: req.requestId }
      });
      return { note, created: true, authorProfileId: locked[0].authorId };
    });
    // Admin-audience only, stamped now: a note must never look like a ticket change to the author.
    if (result.created) announce("ticket.updated", { id: ticketId, authorId: result.authorProfileId, updatedAt: new Date() }, "admin");
    res.status(201).json(internalNoteResponseSchema.parse({ note: serializeInternalNote(result.note) }));
  }));

  /** Assign-to-self (or unassign). Admins cannot assign work to someone else through this endpoint. */
  router.put("/tickets/:ticketId/assignment", asyncHandler(async (req, res) => {
    const input = parseInput(assignTicketSchema, req.body, "assignment");
    const ticketId = req.params.ticketId as string;
    const actorId = req.auth!.user.id;
    if (input.assigneeId !== null && input.assigneeId !== actorId) throw forbidden("Tickets can only be assigned to yourself");

    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Ticket" WHERE "id" = ${ticketId} FOR UPDATE`;
      if (!locked[0]) throw notFound("Ticket not found");
      const current = await tx.ticket.findUniqueOrThrow({ where: { id: ticketId } });
      if (current.status === "CLOSED") throw new AppError("CONFLICT", "Closed tickets cannot be reassigned");
      const latest = await tx.ticketAssignment.findFirst({ where: { ticketId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
      if (current.assigneeId === input.assigneeId) {
        // Idempotent repeat: report existing state without writing history or audit noise.
        if (!latest) throw new AppError("CONFLICT", "Ticket is not assigned");
        return { ticket: current, assignment: latest, changed: false };
      }
      const assignment = await tx.ticketAssignment.create({ data: { ticketId, assigneeId: input.assigneeId, assignedById: actorId } });
      const ticket = await tx.ticket.update({ where: { id: ticketId }, data: { assigneeId: input.assigneeId } });
      await tx.auditLog.create({
        data: {
          actorId, action: "ticket.assignment.updated", entityType: "Ticket", entityId: ticketId,
          before: { assigneeId: current.assigneeId }, after: { assigneeId: input.assigneeId }, requestId: req.requestId
        }
      });
      return { ticket, assignment, changed: true };
    });
    if (result.changed) announce("ticket.updated", result.ticket);
    res.status(200).json(assignmentResponseSchema.parse({ ticket: serializeTicket(result.ticket), assignment: serializeAssignment(result.assignment) }));
  }));

  /** Latest attempt (admin only). Drafts and metadata never appear on author routes. */
  router.get("/tickets/:ticketId/ai-analysis", asyncHandler(async (req, res) => {
    const ticket = await prisma.ticket.findUnique({ where: { id: req.params.ticketId }, select: { id: true } });
    if (!ticket) throw notFound("Ticket not found");
    const latest = await prisma.aiAnalysis.findFirst({ where: { ticketId: ticket.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    res.status(200).json(aiAnalysisResponseSchema.parse({ analysis: latest ? serializeAiAttempt(latest) : null }));
  }));

  /** Starts (or joins) an analysis. 202 while pending, 200 when the returned attempt is already terminal. Never sends anything. */
  router.post("/tickets/:ticketId/ai-analysis", asyncHandler(async (req, res) => {
    const result = await ai.requestRefresh(req.params.ticketId as string, { actorId: req.auth!.user.id, requestId: req.requestId });
    if (!result) throw notFound("Ticket not found");
    if (result.ticketStatus === "CLOSED") throw new AppError("CONFLICT", "Closed tickets cannot be analysed");
    if (result.created) ai.kick(result.attempt.id);
    const attempt = serializeAiAttempt(result.attempt);
    res.status(attempt.status === "PENDING" ? 202 : 200).json(aiAnalysisRequestResponseSchema.parse({ analysis: attempt }));
  }));

  router.get("/tickets/:ticketId/attachments", asyncHandler(async (req, res) => {
    const ticket = await prisma.ticket.findUnique({ where: { id: req.params.ticketId }, select: { id: true } });
    if (!ticket) throw notFound("Ticket not found");
    const rows = await prisma.ticketAttachment.findMany({ where: { ticketId: ticket.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    res.status(200).json(attachmentListResponseSchema.parse({ items: rows.map(serializeAttachment) }));
  }));

  router.get("/tickets/:ticketId/attachments/:attachmentId", asyncHandler(async (req, res) => {
    const attachment = await prisma.ticketAttachment.findFirst({ where: { id: req.params.attachmentId, ticketId: req.params.ticketId } });
    if (!attachment) throw notFound("Attachment not found");
    await sendAttachment(res, storage, attachment);
  }));

  return router;
}
