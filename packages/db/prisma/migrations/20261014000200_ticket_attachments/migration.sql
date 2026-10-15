-- CreateTable
CREATE TABLE "TicketAttachment" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TicketAttachment_storageKey_key" ON "TicketAttachment"("storageKey");

-- CreateIndex
CREATE INDEX "TicketAttachment_ticketId_createdAt_idx" ON "TicketAttachment"("ticketId", "createdAt");

-- AddForeignKey
ALTER TABLE "TicketAttachment" ADD CONSTRAINT "TicketAttachment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketAttachment" ADD CONSTRAINT "TicketAttachment_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Attachment sanity: positive size within the hard 25 MiB ceiling (the API enforces a lower configurable limit).
ALTER TABLE "TicketAttachment" ADD CONSTRAINT "TicketAttachment_size_check" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 26214400);
ALTER TABLE "TicketAttachment" ADD CONSTRAINT "TicketAttachment_name_check" CHECK (length(btrim("fileName")) > 0);

-- Defence in depth for author isolation: a ticket may only link to a book owned by the ticket's author.
CREATE FUNCTION "Ticket_book_author_check"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."bookId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Book" WHERE "id" = NEW."bookId" AND "authorId" = NEW."authorId") THEN
    RAISE EXCEPTION 'Ticket book must belong to the ticket author' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Ticket_book_author" BEFORE INSERT OR UPDATE OF "bookId", "authorId" ON "Ticket"
  FOR EACH ROW EXECUTE FUNCTION "Ticket_book_author_check"();
