import {
  aiAnalysisAttemptSchema, auditEventSchema, authorTicketMessageSchema, internalNoteResourceSchema, ticketAssignmentSchema,
  ticketMessageSchema, ticketSchema, ticketSummarySchema, aiAnalysisSchema
} from "@bookleaf/contracts";
import type { AiAnalysisAttempt, AuditEvent, AuthorTicketMessage, InternalNote, Ticket, TicketAssignment, TicketMessage, TicketSummary } from "@bookleaf/contracts";
import type { AiAnalysis, AuditLog, InternalNote as InternalNoteRow, Ticket as TicketRow, TicketAssignment as AssignmentRow, TicketAttachment, TicketMessage as MessageRow } from "@bookleaf/db";
import { z } from "zod";
import { toTimestamp } from "../http/serialize.js";

// Field-by-field construction + schema parse: nothing from a Prisma row is ever spread into a response.

export const serializeTicketSummary = (t: TicketRow): TicketSummary => ticketSummarySchema.parse({
  id: t.id, authorId: t.authorId, bookId: t.bookId, subject: t.subject, status: t.status, category: t.category, priority: t.priority,
  assigneeId: t.assigneeId, createdAt: toTimestamp(t.createdAt), updatedAt: toTimestamp(t.updatedAt)
});

export const serializeTicket = (t: TicketRow): Ticket => ticketSchema.parse({ ...serializeTicketSummary(t), description: t.description });

/** Author-facing: throws if handed an admin-only message, so a query bug cannot leak one. */
export function serializeAuthorMessage(m: MessageRow): AuthorTicketMessage {
  return authorTicketMessageSchema.parse({ id: m.id, ticketId: m.ticketId, authorId: m.authorId, body: m.body, visibility: m.visibility, createdAt: toTimestamp(m.createdAt) });
}

export const serializeMessage = (m: MessageRow): TicketMessage => ticketMessageSchema.parse({
  id: m.id, ticketId: m.ticketId, authorId: m.authorId, body: m.body, visibility: m.visibility, createdAt: toTimestamp(m.createdAt)
});

export const serializeInternalNote = (n: InternalNoteRow): InternalNote => internalNoteResourceSchema.parse({
  id: n.id, ticketId: n.ticketId, authorId: n.authorId, body: n.body, createdAt: toTimestamp(n.createdAt)
});

export const serializeAssignment = (a: AssignmentRow): TicketAssignment => ticketAssignmentSchema.parse({
  id: a.id, ticketId: a.ticketId, assigneeId: a.assigneeId, assignedById: a.assignedById, createdAt: toTimestamp(a.createdAt)
});

/** No before/after JSON: it can hold private values. */
export const serializeAuditEvent = (e: AuditLog): AuditEvent => auditEventSchema.parse({
  id: e.id, actorId: e.actorId, action: e.action, entityType: e.entityType, entityId: e.entityId, requestId: e.requestId, createdAt: toTimestamp(e.createdAt)
});

/** Maps a stored attempt to the HTTP attempt shape. A malformed COMPLETED row is withheld, never shown as a draft. */
export function serializeAiAttempt(row: AiAnalysis): AiAnalysisAttempt {
  const base = { id: row.id, ticketId: row.ticketId, createdAt: toTimestamp(row.createdAt) };
  if (row.status === "PENDING") return aiAnalysisAttemptSchema.parse({ ...base, status: "PENDING", analysis: null, errorCode: null });
  if (row.status === "FAILED") return aiAnalysisAttemptSchema.parse({ ...base, status: "FAILED", analysis: null, errorCode: row.errorCode?.trim() || "AI_FAILED" });
  const citations = z.array(z.string().min(1)).safeParse(row.citations);
  const analysis = aiAnalysisSchema.safeParse({
    category: row.category, priority: row.priority, confidence: row.confidence, rationale: row.rationale, draftResponse: row.draftResponse,
    requiresHumanReview: true, knowledgeBaseCitations: citations.success ? citations.data : null
  });
  if (!analysis.success) return aiAnalysisAttemptSchema.parse({ ...base, status: "FAILED", analysis: null, errorCode: "INVALID_STORED_ANALYSIS" });
  return aiAnalysisAttemptSchema.parse({ ...base, status: "COMPLETED", analysis: analysis.data, errorCode: null });
}

// Attachment metadata is not in @bookleaf/contracts (reported to the controller); this local schema is the proposal.
export const attachmentSchema = z.object({
  id: z.string().min(1), ticketId: z.string().min(1), fileName: z.string(), contentType: z.string(), sizeBytes: z.number().int().min(1), createdAt: z.string().datetime()
});
export type AttachmentMeta = z.infer<typeof attachmentSchema>;
export const attachmentResponseSchema = z.object({ attachment: attachmentSchema });
export const attachmentListResponseSchema = z.object({ items: z.array(attachmentSchema) });

export const serializeAttachment = (a: TicketAttachment): AttachmentMeta => attachmentSchema.parse({
  id: a.id, ticketId: a.ticketId, fileName: a.fileName, contentType: a.contentType, sizeBytes: a.sizeBytes, createdAt: toTimestamp(a.createdAt)
});
