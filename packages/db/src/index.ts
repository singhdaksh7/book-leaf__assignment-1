/** Server-only exports. Importing this module never constructs or connects a client. */
export { PrismaClient, Prisma, UserRole, TicketStatus, TicketCategory, TicketPriority, MessageVisibility, AiAnalysisStatus } from "@prisma/client";
export type { User, AuthorProfile, Book, Session, Ticket, TicketMessage, InternalNote, TicketAssignment, TicketAttachment, AiAnalysis, AuditLog } from "@prisma/client";
