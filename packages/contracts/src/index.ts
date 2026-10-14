import { z } from "zod";

export const ticketCategories = [
  "ROYALTY_PAYMENTS", "ISBN_METADATA", "PRINTING_QUALITY", "DISTRIBUTION_AVAILABILITY", "BOOK_STATUS_PRODUCTION", "GENERAL_INQUIRY"
] as const;
export const ticketPriorities = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export const ticketStatuses = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;
export const userRoles = ["AUTHOR", "ADMIN"] as const;
export const messageVisibilities = ["AUTHOR", "ADMIN"] as const;
export const aiAnalysisStatuses = ["PENDING", "COMPLETED", "FAILED"] as const;

export const idSchema = z.string().min(1);
export const timestampSchema = z.string().datetime();
export const dateSchema = z.string().date();

export const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional(), requestId: z.string().optional() })
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const loginRequestSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
export const createTicketSchema = z.object({
  bookId: z.string().min(1).nullable(), subject: z.string().trim().min(3).max(200), description: z.string().trim().min(10).max(10_000)
});
export const updateTicketSchema = z.object({
  status: z.enum(ticketStatuses).optional(), category: z.enum(ticketCategories).optional(), priority: z.enum(ticketPriorities).optional()
}).refine((value) => Object.keys(value).length > 0, "At least one ticket property is required");
export const ticketReplySchema = z.object({ body: z.string().trim().min(1).max(10_000) });
export const internalNoteSchema = z.object({ body: z.string().trim().min(1).max(10_000) });
export const assignTicketSchema = z.object({ assigneeId: z.string().min(1).nullable() });
export const ticketFilterSchema = z.object({
  status: z.enum(ticketStatuses).optional(), category: z.enum(ticketCategories).optional(), priority: z.enum(ticketPriorities).optional(),
  from: z.coerce.date().optional(), to: z.coerce.date().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25)
});
export const aiAnalysisSchema = z.object({
  category: z.enum(ticketCategories), priority: z.enum(ticketPriorities), confidence: z.number().min(0).max(1),
  rationale: z.string(), draftResponse: z.string(), requiresHumanReview: z.literal(true), knowledgeBaseCitations: z.array(idSchema)
});

// Wire DTOs use explicit nulls and serialized dates, never Prisma objects directly.
export const authorProfileSchema = z.object({
  id: idSchema, userId: idSchema, externalAuthorId: idSchema,
  name: z.string(), phone: z.string(), city: z.string(), joinedDate: dateSchema
});
export const currentUserSchema = z.object({
  id: idSchema, email: z.string().email(), role: z.enum(userRoles), authorProfile: authorProfileSchema.nullable()
});
export const authResponseSchema = z.object({ user: currentUserSchema });
export const loginResponseSchema = authResponseSchema;
export const meResponseSchema = authResponseSchema;
// Logout returns HTTP 204 with no JSON body.

export const bookSchema = z.object({
  id: idSchema, externalBookId: idSchema, authorId: idSchema,
  title: z.string(), isbn: z.string(), genre: z.string(), publicationDate: dateSchema.nullable(), status: z.string(),
  mrp: z.number().int().nullable(), authorRoyaltyPerCopy: z.number().int().nullable(),
  totalCopiesSold: z.number().int(), totalRoyaltyEarned: z.number().int(), royaltyPaid: z.number().int(), royaltyPending: z.number().int(),
  lastRoyaltyPayoutDate: dateSchema.nullable(), printPartner: z.string().nullable(), availableOn: z.array(z.string())
});
export const paginationSchema = z.object({
  page: z.number().int().min(1), pageSize: z.number().int().min(1).max(100), total: z.number().int().min(0)
});
export const bookListResponseSchema = paginationSchema.extend({ items: z.array(bookSchema) });

export const ticketSummarySchema = z.object({
  id: idSchema, authorId: idSchema, bookId: idSchema.nullable(), subject: z.string(), status: z.enum(ticketStatuses),
  category: z.enum(ticketCategories).nullable(), priority: z.enum(ticketPriorities).nullable(), assigneeId: idSchema.nullable(),
  createdAt: timestampSchema, updatedAt: timestampSchema
});
export const ticketSchema = ticketSummarySchema.extend({ description: z.string() });
export const ticketResponseSchema = z.object({ ticket: ticketSchema });
export const ticketListResponseSchema = paginationSchema.extend({ items: z.array(ticketSummarySchema) });
export const adminQueueResponseSchema = ticketListResponseSchema;

export const ticketMessageSchema = z.object({
  id: idSchema, ticketId: idSchema, authorId: idSchema, body: z.string(),
  visibility: z.enum(messageVisibilities), createdAt: timestampSchema
});
export const authorTicketMessageSchema = ticketMessageSchema.extend({ visibility: z.literal("AUTHOR") });
export const ticketMessageResponseSchema = z.object({ message: authorTicketMessageSchema });
export const ticketDetailResponseSchema = z.object({ ticket: ticketSchema, messages: z.array(authorTicketMessageSchema) });
export const internalNoteResourceSchema = z.object({
  id: idSchema, ticketId: idSchema, authorId: idSchema, body: z.string(), createdAt: timestampSchema
});
export const internalNoteResponseSchema = z.object({ note: internalNoteResourceSchema });
export const ticketAssignmentSchema = z.object({
  id: idSchema, ticketId: idSchema, assigneeId: idSchema.nullable(), assignedById: idSchema, createdAt: timestampSchema
});
export const assignmentResponseSchema = z.object({ ticket: ticketSchema, assignment: ticketAssignmentSchema });
// Deliberately excludes raw before/after JSON; it can contain private record data.
export const auditEventSchema = z.object({
  id: idSchema, actorId: idSchema.nullable(), action: z.string(), entityType: z.string(), entityId: idSchema,
  requestId: z.string().nullable(), createdAt: timestampSchema
});

const analysisAttemptFields = { id: idSchema, ticketId: idSchema, createdAt: timestampSchema };
// AiService returns a completed result; HTTP resources also represent pending/failed attempts.
export const aiAnalysisAttemptSchema = z.discriminatedUnion("status", [
  z.object({ ...analysisAttemptFields, status: z.literal("PENDING"), analysis: z.null(), errorCode: z.null() }),
  z.object({ ...analysisAttemptFields, status: z.literal("COMPLETED"), analysis: aiAnalysisSchema, errorCode: z.null() }),
  z.object({ ...analysisAttemptFields, status: z.literal("FAILED"), analysis: z.null(), errorCode: z.string().min(1) })
]);
export const aiAnalysisResponseSchema = z.object({ analysis: aiAnalysisAttemptSchema.nullable() });
export const aiAnalysisRequestResponseSchema = z.object({ analysis: aiAnalysisAttemptSchema });
export const adminTicketDetailResponseSchema = z.object({
  ticket: ticketSchema, author: authorProfileSchema, book: bookSchema.nullable(),
  messages: z.array(ticketMessageSchema), internalNotes: z.array(internalNoteResourceSchema),
  assignments: z.array(ticketAssignmentSchema), aiAnalysis: aiAnalysisAttemptSchema.nullable(), auditEvents: z.array(auditEventSchema)
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type CreateTicketRequest = z.infer<typeof createTicketSchema>;
export type UpdateTicketRequest = z.infer<typeof updateTicketSchema>;
export type TicketReplyRequest = z.infer<typeof ticketReplySchema>;
export type InternalNoteRequest = z.infer<typeof internalNoteSchema>;
export type AssignTicketRequest = z.infer<typeof assignTicketSchema>;
export type TicketFilter = z.infer<typeof ticketFilterSchema>;
export type AuthorProfile = z.infer<typeof authorProfileSchema>;
export type CurrentUser = z.infer<typeof currentUserSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type Book = z.infer<typeof bookSchema>;
export type Pagination = z.infer<typeof paginationSchema>;
export type BookListResponse = z.infer<typeof bookListResponseSchema>;
export type TicketSummary = z.infer<typeof ticketSummarySchema>;
export type Ticket = z.infer<typeof ticketSchema>;
export type TicketResponse = z.infer<typeof ticketResponseSchema>;
export type TicketListResponse = z.infer<typeof ticketListResponseSchema>;
export type AdminQueueResponse = z.infer<typeof adminQueueResponseSchema>;
export type TicketMessage = z.infer<typeof ticketMessageSchema>;
export type AuthorTicketMessage = z.infer<typeof authorTicketMessageSchema>;
export type TicketMessageResponse = z.infer<typeof ticketMessageResponseSchema>;
export type TicketDetailResponse = z.infer<typeof ticketDetailResponseSchema>;
export type InternalNote = z.infer<typeof internalNoteResourceSchema>;
export type InternalNoteResponse = z.infer<typeof internalNoteResponseSchema>;
export type TicketAssignment = z.infer<typeof ticketAssignmentSchema>;
export type AssignmentResponse = z.infer<typeof assignmentResponseSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type TicketAiAnalysis = z.infer<typeof aiAnalysisSchema>;
export type AiAnalysisAttempt = z.infer<typeof aiAnalysisAttemptSchema>;
export type AiAnalysisResponse = z.infer<typeof aiAnalysisResponseSchema>;
export type AiAnalysisRequestResponse = z.infer<typeof aiAnalysisRequestResponseSchema>;
export type AdminTicketDetailResponse = z.infer<typeof adminTicketDetailResponseSchema>;
