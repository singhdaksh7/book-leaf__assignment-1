import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@bookleaf/db";
import { importSeedData, parseSeedDataset, SeedConflictError, SeedValidationError, type SeedDataset } from "@bookleaf/db/seed";
import { ADMIN_EMAIL, TEST_PASSWORD, fastHash, loadSyntheticDataset, resetDatabase, seedSynthetic } from "./helpers.js";

const prisma = new PrismaClient();
const credentials = { authorPassword: TEST_PASSWORD, adminEmail: ADMIN_EMAIL, adminPassword: TEST_PASSWORD };
const clone = <T>(value: T): T => structuredClone(value);
const dateOnly = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);

beforeEach(async () => {
  await resetDatabase(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("synthetic fixture", () => {
  it("has the shape of the original dataset: 10 authors, 18 books, with the documented edge cases", () => {
    const dataset = loadSyntheticDataset();
    expect(dataset).toHaveLength(10);
    expect(dataset.flatMap((a) => a.books)).toHaveLength(18);
    const books = dataset.flatMap((a) => a.books);
    expect(books.some((b) => b.publication_date === null && b.mrp === null && b.author_royalty_per_copy === null && b.print_partner === null)).toBe(true);
    expect(books.some((b) => b.last_royalty_payout_date === null)).toBe(true);
    expect(books.some((b) => b.available_on.length === 0)).toBe(true);
    expect(books.some((b) => b.total_royalty_earned === 0)).toBe(true);
  });
});

describe("importSeedData", () => {
  it("writes every author and book with values identical to the source (nulls, zeros, empty arrays included)", async () => {
    const { dataset, summary } = await seedSynthetic(prisma);
    expect(summary).toMatchObject({ authors: 10, books: 18, usersCreated: 10, adminCreated: true, passwordsReset: 0 });
    expect(await prisma.authorProfile.count()).toBe(10);
    expect(await prisma.book.count()).toBe(18);

    for (const author of dataset) {
      const profile = await prisma.authorProfile.findUniqueOrThrow({ where: { externalAuthorId: author.author_id }, include: { user: true } });
      expect(profile).toMatchObject({ name: author.name, phone: author.phone, city: author.city });
      expect(dateOnly(profile.joinedDate)).toBe(author.joined_date);
      expect(profile.user).toMatchObject({ email: author.email.toLowerCase(), role: "AUTHOR" });
      for (const book of author.books) {
        const row = await prisma.book.findUniqueOrThrow({ where: { externalBookId: book.book_id } });
        expect(row.authorId).toBe(profile.id);
        expect({
          title: row.title, isbn: row.isbn, genre: row.genre, publication_date: dateOnly(row.publicationDate), status: row.status, mrp: row.mrp,
          author_royalty_per_copy: row.authorRoyaltyPerCopy, total_copies_sold: row.totalCopiesSold, total_royalty_earned: row.totalRoyaltyEarned,
          royalty_paid: row.royaltyPaid, royalty_pending: row.royaltyPending, last_royalty_payout_date: dateOnly(row.lastRoyaltyPayoutDate),
          print_partner: row.printPartner, available_on: row.availableOn
        }).toEqual({
          title: book.title, isbn: book.isbn, genre: book.genre, publication_date: book.publication_date, status: book.status, mrp: book.mrp,
          author_royalty_per_copy: book.author_royalty_per_copy, total_copies_sold: book.total_copies_sold, total_royalty_earned: book.total_royalty_earned,
          royalty_paid: book.royalty_paid, royalty_pending: book.royalty_pending, last_royalty_payout_date: book.last_royalty_payout_date,
          print_partner: book.print_partner, available_on: book.available_on
        });
      }
    }
  });

  it("is idempotent and does not silently reset existing passwords", async () => {
    await seedSynthetic(prisma);
    const before = await prisma.user.findMany({ orderBy: { email: "asc" }, select: { id: true, passwordHash: true } });

    const second = await importSeedData(prisma, loadSyntheticDataset(), { credentials: { ...credentials, authorPassword: "a different password 123" }, hash: fastHash });
    expect(second).toMatchObject({ authors: 10, books: 18, usersCreated: 0, adminCreated: false, passwordsReset: 0 });
    expect(await prisma.authorProfile.count()).toBe(10);
    expect(await prisma.book.count()).toBe(18);
    expect(await prisma.user.count()).toBe(11);
    expect(await prisma.user.findMany({ orderBy: { email: "asc" }, select: { id: true, passwordHash: true } })).toEqual(before);
  });

  it("resets passwords only when explicitly asked", async () => {
    await seedSynthetic(prisma);
    const before = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    const result = await importSeedData(prisma, loadSyntheticDataset(), { credentials: { ...credentials, resetPasswords: true }, hash: fastHash });
    expect(result.passwordsReset).toBe(11);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } })).passwordHash).not.toBe(before.passwordHash);
  });

  it("restores source values on re-run and preserves existing tickets", async () => {
    const { dataset } = await seedSynthetic(prisma);
    const author = await prisma.authorProfile.findFirstOrThrow({ where: { externalAuthorId: dataset[0]!.author_id } });
    const book = dataset[0]!.books[0]!;
    await prisma.book.update({ where: { externalBookId: book.book_id }, data: { title: "tampered", royaltyPending: 1 } });
    const ticket = await prisma.ticket.create({ data: { authorId: author.id, subject: "Existing ticket", description: "Should survive a re-seed" } });

    await importSeedData(prisma, dataset, { credentials, hash: fastHash });
    expect((await prisma.book.findUniqueOrThrow({ where: { externalBookId: book.book_id } })).title).toBe(book.title);
    expect(await prisma.ticket.findUnique({ where: { id: ticket.id } })).not.toBeNull();
  });

  it("rolls back everything when a later record conflicts", async () => {
    const { dataset } = await seedSynthetic(prisma);
    await resetDatabase(prisma);
    // Author 0 is fine; author 1 claims a book that already belongs to someone else.
    const [a, b] = dataset;
    const stolen = a!.books[0]!;
    const owner = await prisma.user.create({ data: { email: "owner@example.test", passwordHash: "x", role: "AUTHOR" } });
    const ownerProfile = await prisma.authorProfile.create({ data: { userId: owner.id, externalAuthorId: "OTHER", name: "Other", phone: "", city: "", joinedDate: new Date("2020-01-01") } });
    await prisma.book.create({ data: { externalBookId: stolen.book_id, authorId: ownerProfile.id, title: "t", isbn: "i", genre: "g", status: "s", totalCopiesSold: 0, totalRoyaltyEarned: 0, royaltyPaid: 0, royaltyPending: 0 } });

    const input: SeedDataset = [clone(b!), clone(a!)]; // b would be written first, then a conflicts
    await expect(importSeedData(prisma, input, { credentials, hash: fastHash })).rejects.toBeInstanceOf(SeedConflictError);
    expect(await prisma.authorProfile.count()).toBe(1); // only the pre-existing "OTHER"
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.book.count()).toBe(1);
  });

  it("refuses weak seed passwords and role collisions", async () => {
    const dataset = loadSyntheticDataset();
    await expect(importSeedData(prisma, dataset, { credentials: { authorPassword: "short" }, hash: fastHash })).rejects.toBeInstanceOf(SeedConflictError);
    await expect(importSeedData(prisma, dataset, { credentials: { authorPassword: TEST_PASSWORD, adminEmail: dataset[0]!.email, adminPassword: TEST_PASSWORD }, hash: fastHash })).rejects.toBeInstanceOf(SeedConflictError);
    await prisma.user.create({ data: { email: dataset[0]!.email, passwordHash: "x", role: "ADMIN" } });
    await expect(importSeedData(prisma, dataset, { credentials, hash: fastHash })).rejects.toBeInstanceOf(SeedConflictError);
    expect(await prisma.book.count()).toBe(0);
  });
});

describe("parseSeedDataset", () => {
  const good = () => clone(loadSyntheticDataset());

  it("accepts a bare array or an { authors } wrapper", () => {
    expect(parseSeedDataset(good())).toHaveLength(10);
    expect(parseSeedDataset({ authors: good() })).toHaveLength(10);
  });

  const mutations: Array<[string, (d: ReturnType<typeof good>) => void]> = [
    ["negative royalty", (d) => { d[0]!.books[0]!.royalty_paid = -1; }],
    ["fractional count", (d) => { d[0]!.books[0]!.total_copies_sold = 1.5; }],
    ["missing field", (d) => { delete (d[0]!.books[0] as Partial<(typeof d)[0]["books"][0]>).isbn; }],
    ["undefined instead of null", (d) => { (d[0]!.books[0] as Record<string, unknown>).mrp = undefined; }],
    ["impossible date", (d) => { d[0]!.joined_date = "2024-02-30"; }],
    ["timestamp for a date-only field", (d) => { d[0]!.books[0]!.publication_date = "2025-01-01T00:00:00Z"; }],
    ["unexpected field", (d) => { (d[0] as Record<string, unknown>).extra = "x"; }],
    ["invalid email", (d) => { d[0]!.email = "nope"; }],
    ["duplicate author_id", (d) => { d[1]!.author_id = d[0]!.author_id; }],
    ["duplicate book_id", (d) => { d[1]!.books[0]!.book_id = d[0]!.books[0]!.book_id; }],
    ["duplicate email (case-insensitive)", (d) => { d[1]!.email = d[0]!.email.toUpperCase(); }]
  ];
  for (const [name, mutate] of mutations) {
    it(`rejects ${name}`, () => {
      const data = good();
      mutate(data);
      expect(() => parseSeedDataset(data)).toThrow(SeedValidationError);
    });
  }

  it("rejects non-array input and empty datasets", () => {
    for (const input of [null, "text", 42, {}, [], { authors: [] }]) expect(() => parseSeedDataset(input)).toThrow(SeedValidationError);
  });

  it("never echoes record values in its messages", () => {
    const data = good();
    data[0]!.name = "";
    data[0]!.phone = 12345 as unknown as string;
    data[0]!.books[0]!.title = "Confidential Title 0xBEEF" as string;
    data[0]!.books[0]!.royalty_paid = "SECRET-VALUE" as unknown as number;
    try {
      parseSeedDataset(data);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SeedValidationError);
      const text = `${(error as Error).message} ${(error as SeedValidationError).issues.join(" ")}`;
      expect(text).not.toMatch(/SECRET-VALUE|0xBEEF|12345/);
      expect(text).toMatch(/royalty_paid/);
    }
  });
});

describe("database integrity constraints", () => {
  it("rejects impossible book values and unnormalised emails", async () => {
    await seedSynthetic(prisma);
    await expect(prisma.book.updateMany({ data: { totalCopiesSold: -1 } })).rejects.toThrow();
    await expect(prisma.book.updateMany({ data: { mrp: -5 } })).rejects.toThrow();
    await expect(prisma.user.create({ data: { email: "Mixed@Example.test", passwordHash: "x", role: "AUTHOR" } })).rejects.toThrow();
    await expect(prisma.user.create({ data: { email: ADMIN_EMAIL, passwordHash: "x", role: "ADMIN" } })).rejects.toThrow(); // unique
  });

  it("accepts null/zero royalty values (they are valid source states)", async () => {
    await seedSynthetic(prisma);
    await expect(prisma.book.updateMany({ data: { mrp: null, authorRoyaltyPerCopy: null, totalRoyaltyEarned: 0 } })).resolves.toBeDefined();
  });

  it("enforces AI analysis state invariants", async () => {
    const { dataset } = await seedSynthetic(prisma);
    const author = await prisma.authorProfile.findFirstOrThrow({ where: { externalAuthorId: dataset[0]!.author_id } });
    const ticket = await prisma.ticket.create({ data: { authorId: author.id, subject: "Subject", description: "Description text" } });
    const base = { ticketId: ticket.id, promptVersion: "v1" };
    await expect(prisma.aiAnalysis.create({ data: { ...base, status: "PENDING" } })).resolves.toBeDefined();
    await expect(prisma.aiAnalysis.create({ data: { ...base, status: "FAILED", errorCode: "AI_UNAVAILABLE" } })).resolves.toBeDefined();
    await expect(prisma.aiAnalysis.create({ data: { ...base, status: "FAILED" } })).rejects.toThrow(); // no error code
    await expect(prisma.aiAnalysis.create({ data: { ...base, status: "PENDING", rationale: "partial draft" } })).rejects.toThrow();
    await expect(prisma.aiAnalysis.create({ data: { ...base, status: "COMPLETED", category: "GENERAL_INQUIRY" } })).rejects.toThrow(); // partial result
    const complete = { category: "GENERAL_INQUIRY", priority: "LOW", confidence: 0.4, rationale: "r", draftResponse: "d", citations: ["kb-1"] } as const;
    await expect(prisma.aiAnalysis.create({ data: { ...base, status: "COMPLETED", ...complete } })).resolves.toBeDefined();
    await expect(prisma.aiAnalysis.create({ data: { ...base, status: "COMPLETED", ...complete, confidence: 1.5 } })).rejects.toThrow();
    await expect(prisma.aiAnalysis.create({ data: { ...base, status: "COMPLETED", ...complete, citations: { not: "an array" } } })).rejects.toThrow();
  });

  it("makes the audit log append-only", async () => {
    await seedSynthetic(prisma);
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    const entry = await prisma.auditLog.create({ data: { actorId: admin.id, action: "ticket.updated", entityType: "Ticket", entityId: "t1" } });
    await expect(prisma.auditLog.update({ where: { id: entry.id }, data: { action: "tampered" } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow(/append-only/);
    // Deleting a user nulls the actor reference but keeps the entry.
    await prisma.user.delete({ where: { id: admin.id } });
    expect((await prisma.auditLog.findUniqueOrThrow({ where: { id: entry.id } })).actorId).toBeNull();
  });
});
