-- Defence in depth for rules the API already enforces. A future code path that forgets them is stopped by the database.

-- Assignees, assigners and internal-note authors must be ADMIN users.
CREATE FUNCTION "Ticket_assignee_admin_check"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."assigneeId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" WHERE "id" = NEW."assigneeId" AND "role" = 'ADMIN') THEN
    RAISE EXCEPTION 'Ticket assignee must be an admin' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Ticket_assignee_admin" BEFORE INSERT OR UPDATE OF "assigneeId" ON "Ticket"
  FOR EACH ROW EXECUTE FUNCTION "Ticket_assignee_admin_check"();

CREATE FUNCTION "TicketAssignment_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM "User" WHERE "id" = NEW."assignedById" AND "role" = 'ADMIN') THEN
      RAISE EXCEPTION 'Assignments can only be made by an admin' USING ERRCODE = '23514';
    END IF;
    IF NEW."assigneeId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" WHERE "id" = NEW."assigneeId" AND "role" = 'ADMIN') THEN
      RAISE EXCEPTION 'Ticket assignee must be an admin' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  -- History is append-only. The one permitted change is ON DELETE SET NULL of the assignee when a user is removed.
  IF NEW."assigneeId" IS NULL
     AND (NEW."id", NEW."ticketId", NEW."assignedById", NEW."createdAt") IS NOT DISTINCT FROM (OLD."id", OLD."ticketId", OLD."assignedById", OLD."createdAt") THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'TicketAssignment history is append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "TicketAssignment_guard" BEFORE INSERT OR UPDATE ON "TicketAssignment"
  FOR EACH ROW EXECUTE FUNCTION "TicketAssignment_guard"();

CREATE FUNCTION "InternalNote_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'InternalNote is immutable' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "User" WHERE "id" = NEW."authorId" AND "role" = 'ADMIN') THEN
    RAISE EXCEPTION 'Internal notes can only be written by an admin' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "InternalNote_guard" BEFORE INSERT OR UPDATE ON "InternalNote"
  FOR EACH ROW EXECUTE FUNCTION "InternalNote_guard"();

-- Admin-only messages must come from an admin.
CREATE FUNCTION "TicketMessage_visibility_check"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."visibility" = 'ADMIN' AND NOT EXISTS (SELECT 1 FROM "User" WHERE "id" = NEW."authorId" AND "role" = 'ADMIN') THEN
    RAISE EXCEPTION 'Admin-only messages must be written by an admin' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "TicketMessage_visibility" BEFORE INSERT ON "TicketMessage"
  FOR EACH ROW EXECUTE FUNCTION "TicketMessage_visibility_check"();
