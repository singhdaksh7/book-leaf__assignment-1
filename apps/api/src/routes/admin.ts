import { Router } from "express";
import {
  adminQueueResponseSchema, adminTicketDetailResponseSchema, ticketResponseSchema, updateTicketSchema
} from "@bookleaf/contracts";
import { Prisma, type PrismaClient } from "@bookleaf/db";
import { requireRole } from "../auth/middleware.js";
import type { AttachmentStorage } from "../attachments/storage.js";
import { AppError, notFound } from "../http/errors.js";
import { asyncHandler, parseInput } from "../http/validate.js";
import { serializeAuthorProfile, serializeBook } from "../serializers.js";
import { filterWhere, parseTicketFilter } from "../tickets/filters.js";
import {
  attachmentListResponseSchema, serializeAiAttempt, serializeAssignment, serializeAttachment, serializeAuditEvent, serializeInternalNote,
  serializeMessage, serializeTicket, serializeTicketSummary
} from "../tickets/serializers.js";
import { canTransition } from "../tickets/transitions.js";
import { sendAttachment } from "./author.js";

export interface AdminRouterOptions {
  prisma: PrismaClient;
  storage: AttachmentStorage;
}

const unresolvedSql = Prisma.sql`"status" IN ('OPEN', 'IN_PROGRESS')`;

export function createAdminRouter({ prisma, storage }: AdminRouterOptions): Router {
  const router = Router();
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

    const updated = await prisma.$transaction(async (tx) => {
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

      if (changes.length === 0) return current;
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
      return ticket;
    });
    res.status(200).json(ticketResponseSchema.parse({ ticket: serializeTicket(updated) }));
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
