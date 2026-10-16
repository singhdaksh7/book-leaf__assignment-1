import { describe, it, expect } from "vitest";
import { MockApiClient } from "../api/mock";
import {
  bookListResponseSchema,
  bookSchema,
  ticketListResponseSchema,
  ticketDetailResponseSchema,
  loginResponseSchema,
} from "@bookleaf/contracts";

describe("MockApiClient Contract Fidelity", () => {
  const client = new MockApiClient();

  it("authenticates and returns valid loginResponseSchema shape", async () => {
    const res = await client.login({
      email: "author@bookleafpublishing.test",
      password: "pass",
    });

    const parsed = loginResponseSchema.safeParse(res);
    expect(parsed.success).toBe(true);
    expect(res.user.role).toBe("AUTHOR");
    expect(res.user.authorProfile?.externalAuthorId).toBe("BL-AUTH-8821");
  });

  it("returns books that strictly conform to bookListResponseSchema and bookSchema", async () => {
    const res = await client.getBooks();

    const parsedList = bookListResponseSchema.safeParse(res);
    expect(parsedList.success).toBe(true);

    for (const book of res.items) {
      const parsedBook = bookSchema.safeParse(book);
      expect(parsedBook.success).toBe(true);
    }
  });

  it("preserves nulls for unreleased or unassigned book properties without coercion", async () => {
    const res = await client.getBooks();
    const draftBook = res.items.find((b) => b.status === "DRAFT_TYPESETTING");

    expect(draftBook).toBeDefined();
    expect(draftBook?.mrp).toBeNull();
    expect(draftBook?.authorRoyaltyPerCopy).toBeNull();
    expect(draftBook?.publicationDate).toBeNull();
    expect(draftBook?.printPartner).toBeNull();
    expect(draftBook?.availableOn).toEqual([]);
  });

  it("creates a ticket matching createTicketSchema and ticketDetailResponseSchema", async () => {
    const newTicketRes = await client.createTicket({
      bookId: null,
      subject: "Tax residency update",
      description: "Please update my state tax file for annual 1099 distribution.",
    });

    expect(newTicketRes.ticket.id).toBeDefined();
    expect(newTicketRes.ticket.bookId).toBeNull();
    expect(newTicketRes.ticket.status).toBe("OPEN");

    const detail = await client.getTicketById(newTicketRes.ticket.id);
    const parsedDetail = ticketDetailResponseSchema.safeParse(detail);
    expect(parsedDetail.success).toBe(true);
    expect(detail.messages.length).toBeGreaterThan(0);
  });
});
