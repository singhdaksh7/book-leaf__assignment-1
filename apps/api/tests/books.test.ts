import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { bookListResponseSchema } from "@bookleaf/contracts";
import { PrismaClient } from "@bookleaf/db";
import { ADMIN_EMAIL, createTestApp, loadSyntheticDataset, login, resetDatabase, seedSynthetic } from "./helpers.js";
import type { SeedBook } from "@bookleaf/db/seed";

const prisma = new PrismaClient();
const { app, config } = createTestApp(prisma);
const dataset = loadSyntheticDataset();

beforeAll(async () => {
  await resetDatabase(prisma);
  await seedSynthetic(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

// Wire shape expected for a source book: names mapped, values (including null/0/[]) unchanged.
const expectedWire = (book: SeedBook) => ({
  externalBookId: book.book_id, title: book.title, isbn: book.isbn, genre: book.genre, publicationDate: book.publication_date, status: book.status,
  mrp: book.mrp, authorRoyaltyPerCopy: book.author_royalty_per_copy, totalCopiesSold: book.total_copies_sold,
  totalRoyaltyEarned: book.total_royalty_earned, royaltyPaid: book.royalty_paid, royaltyPending: book.royalty_pending,
  lastRoyaltyPayoutDate: book.last_royalty_payout_date, printPartner: book.print_partner, availableOn: book.available_on
});

describe("GET /author/books", () => {
  it("requires authentication and the AUTHOR role", async () => {
    expect((await request(app).get("/api/v1/author/books")).status).toBe(401);
    const admin = await login(app, config, ADMIN_EMAIL);
    const response = await admin.agent.get("/api/v1/author/books");
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("denies an AUTHOR account that has no author profile", async () => {
    const email = "orphan@example.test";
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    await prisma.user.create({ data: { email, role: "AUTHOR", passwordHash: admin.passwordHash } });
    const orphan = await login(app, config, email);
    expect((await orphan.agent.get("/api/v1/author/books")).status).toBe(403);
  });

  it("returns exactly the caller's books, for every author, preserving source values", async () => {
    for (const author of dataset) {
      const { agent } = await login(app, config, author.email);
      const response = await agent.get("/api/v1/author/books");
      expect(response.status).toBe(200);
      const body = bookListResponseSchema.parse(response.body);
      expect(body).toMatchObject({ page: 1, pageSize: 25, total: author.books.length });
      const profile = await prisma.authorProfile.findUniqueOrThrow({ where: { externalAuthorId: author.author_id } });
      const sorted = [...author.books].sort((a, b) => a.book_id.localeCompare(b.book_id));
      expect(body.items.map((b) => b.externalBookId)).toEqual(sorted.map((b) => b.book_id));
      for (const [index, book] of body.items.entries()) {
        expect(book.authorId).toBe(profile.id);
        expect(book).toMatchObject(expectedWire(sorted[index]!));
      }
    }
  });

  it("keeps nulls, zeros and empty availability exactly as supplied", async () => {
    const all = dataset.flatMap((a) => a.books);
    expect(all.some((b) => b.mrp === null && b.publication_date === null && b.print_partner === null && b.available_on.length === 0)).toBe(true);
    expect(all.some((b) => b.total_royalty_earned === 0)).toBe(true);
    expect(all.some((b) => b.last_royalty_payout_date === null)).toBe(true);
    const inProduction = dataset.find((a) => a.books.some((b) => b.mrp === null))!;
    const { agent } = await login(app, config, inProduction.email);
    const body = (await agent.get("/api/v1/author/books")).body;
    const raw = body.items.find((b: { mrp: number | null }) => b.mrp === null);
    expect(raw).toMatchObject({ mrp: null, authorRoyaltyPerCopy: null, publicationDate: null, printPartner: null, lastRoyaltyPayoutDate: null, availableOn: [], totalRoyaltyEarned: 0 });
  });

  it("formats date-only fields as YYYY-MM-DD", async () => {
    const author = dataset.find((a) => a.books.some((b) => b.publication_date))!;
    const { agent } = await login(app, config, author.email);
    const body = (await agent.get("/api/v1/author/books")).body;
    for (const book of body.items) {
      if (book.publicationDate) expect(book.publicationDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (book.lastRoyaltyPayoutDate) expect(book.lastRoyaltyPayoutDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("cannot be steered to another author's books by query parameters", async () => {
    const [first, second] = dataset;
    const other = await prisma.authorProfile.findUniqueOrThrow({ where: { externalAuthorId: second!.author_id } });
    const { agent } = await login(app, config, first!.email);
    for (const query of [`authorId=${other.id}`, `authorProfileId=${other.id}`, `externalAuthorId=${second!.author_id}`]) {
      const response = await agent.get(`/api/v1/author/books?${query}`);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("does not expose books by id: there is no cross-author route", async () => {
    const [first, second] = dataset;
    const { agent } = await login(app, config, first!.email);
    const foreignBook = await prisma.book.findFirstOrThrow({ where: { author: { externalAuthorId: second!.author_id } } });
    expect((await agent.get(`/api/v1/author/books/${foreignBook.id}`)).status).toBe(404);
  });

  it("paginates with the common envelope", async () => {
    const author = dataset[0]!;
    const { agent } = await login(app, config, author.email);
    const page1 = await agent.get("/api/v1/author/books?page=1&pageSize=1");
    const page2 = await agent.get("/api/v1/author/books?page=2&pageSize=1");
    expect(page1.body).toMatchObject({ page: 1, pageSize: 1, total: 2 });
    expect(page1.body.items).toHaveLength(1);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.items[0].id).not.toBe(page1.body.items[0].id);
    const beyond = await agent.get("/api/v1/author/books?page=9&pageSize=1");
    expect(beyond.status).toBe(200);
    expect(beyond.body).toEqual({ items: [], page: 9, pageSize: 1, total: 2 });
  });

  it("rejects invalid pagination", async () => {
    const { agent } = await login(app, config, dataset[0]!.email);
    for (const query of ["page=0", "pageSize=101", "pageSize=0", "page=abc", "page=1.5", "page=1&page=2"]) {
      const response = await agent.get(`/api/v1/author/books?${query}`);
      expect(response.status, query).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    }
  });
});

describe("GET /auth/me for authors", () => {
  it("returns the caller's own profile only", async () => {
    for (const author of dataset.slice(0, 3)) {
      const { agent } = await login(app, config, author.email);
      const me = await agent.get("/api/v1/auth/me");
      expect(me.body.user.authorProfile).toMatchObject({
        externalAuthorId: author.author_id, name: author.name, phone: author.phone, city: author.city, joinedDate: author.joined_date
      });
      expect(me.body.user.email).toBe(author.email);
    }
  });
});
