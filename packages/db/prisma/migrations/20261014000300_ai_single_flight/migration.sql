-- Durable single-flight for AI analysis: a ticket can have at most one in-flight (PENDING) attempt, regardless of how many
-- API processes run. Prisma cannot express partial indexes, so this lives only in SQL (like the other integrity rules).
CREATE UNIQUE INDEX "AiAnalysis_one_pending_per_ticket" ON "AiAnalysis"("ticketId") WHERE "status" = 'PENDING';

-- Supports "latest attempt" and abandoned-attempt recovery scans.
CREATE INDEX "AiAnalysis_status_createdAt_idx" ON "AiAnalysis"("status", "createdAt");
