-- Integrity rules Prisma cannot express. Source values are never recomputed; these only reject impossible data.

-- Login identity is stored normalised so the unique index is case-insensitive in effect.
ALTER TABLE "User" ADD CONSTRAINT "User_email_normalised_check" CHECK ("email" = lower(btrim("email")) AND length("email") > 0);

-- Book money/count fields are whole, non-negative values. NULL (unknown source value) stays valid; zero stays valid.
ALTER TABLE "Book" ADD CONSTRAINT "Book_non_negative_check" CHECK (
  "totalCopiesSold" >= 0 AND "totalRoyaltyEarned" >= 0 AND "royaltyPaid" >= 0 AND "royaltyPending" >= 0
  AND ("mrp" IS NULL OR "mrp" >= 0)
  AND ("authorRoyaltyPerCopy" IS NULL OR "authorRoyaltyPerCopy" >= 0)
);

ALTER TABLE "Session" ADD CONSTRAINT "Session_expiry_check" CHECK ("expiresAt" > "createdAt");

ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_text_check" CHECK (length(btrim("subject")) > 0 AND length(btrim("description")) > 0);
ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_body_check" CHECK (length(btrim("body")) > 0);
ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_body_check" CHECK (length(btrim("body")) > 0);

-- AiAnalysis state invariants from docs/DATABASE_SCHEMA.md: result and state are stored together or not at all.
ALTER TABLE "AiAnalysis" ADD CONSTRAINT "AiAnalysis_state_check" CHECK (
  CASE "status"
    WHEN 'PENDING' THEN
      "category" IS NULL AND "priority" IS NULL AND "confidence" IS NULL AND "rationale" IS NULL
      AND "draftResponse" IS NULL AND "citations" IS NULL AND "errorCode" IS NULL
    WHEN 'COMPLETED' THEN
      "category" IS NOT NULL AND "priority" IS NOT NULL AND "confidence" IS NOT NULL AND "rationale" IS NOT NULL
      AND "draftResponse" IS NOT NULL AND "citations" IS NOT NULL AND jsonb_typeof("citations") = 'array'
      AND "errorCode" IS NULL
    WHEN 'FAILED' THEN
      "category" IS NULL AND "priority" IS NULL AND "confidence" IS NULL AND "rationale" IS NULL
      AND "draftResponse" IS NULL AND "citations" IS NULL AND "errorCode" IS NOT NULL AND length(btrim("errorCode")) > 0
  END
);
ALTER TABLE "AiAnalysis" ADD CONSTRAINT "AiAnalysis_confidence_range_check" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1));

-- Audit log is append-only. The only permitted change is the ON DELETE SET NULL of "actorId" when a user is removed.
CREATE FUNCTION "AuditLog_reject_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."actorId" IS NULL
       AND (NEW."id", NEW."action", NEW."entityType", NEW."entityId", NEW."before", NEW."after", NEW."requestId", NEW."createdAt")
         IS NOT DISTINCT FROM (OLD."id", OLD."action", OLD."entityType", OLD."entityId", OLD."before", OLD."after", OLD."requestId", OLD."createdAt") THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'AuditLog is append-only';
END;
$$;
CREATE TRIGGER "AuditLog_append_only" BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION "AuditLog_reject_change"();
