import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { PrismaClient } from "@bookleaf/db";
import { AdminError, ensureAdmin } from "@bookleaf/db/admin";
import { CleanupError, TABLES, deleteAttachmentFiles, executeCleanup, inspectAttachmentFiles, planCleanup, tableCounts } from "@bookleaf/db/cleanup";
import { SYNTHETIC_AUTHOR_EMAILS } from "@bookleaf/db/synthetic";
import { SeedConflictError, assertSeedAllowed, importSeedData, isSyntheticDataset } from "@bookleaf/db/seed";
import { ADMIN_EMAIL, TEST_PASSWORD, WEB_ORIGIN, createTestApp, fastHash, loadSyntheticDataset, profileFor, resetDatabase, seedSynthetic } from "./helpers.js";

const prisma = new PrismaClient();
const { app } = createTestApp(prisma);
const BACKUP = "20261016T054443Z";
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "bookleaf-attach-"));
});
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await prisma.$disconnect();
});

const newKey = () => randomBytes(24).toString("hex");

/** A realistic mixed database: synthetic seed + activity, the admin, and one genuinely registered author with a ticket. */
async function populate() {
  await resetDatabase(prisma);
  for (const name of readdirSync(dir)) rmSync(join(dir, name), { force: true });
  await seedSynthetic(prisma);
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
  const keys: string[] = [];

  for (const externalAuthorId of ["SYN-A001", "SYN-A002"]) {
    const profile = await profileFor(prisma, externalAuthorId);
    const book = await prisma.book.findFirstOrThrow({ where: { authorId: profile.id } });
    for (let i = 0; i < 2; i += 1) {
      const ticket = await prisma.ticket.create({ data: { authorId: profile.id, bookId: i === 0 ? book.id : null, subject: `Synthetic ${externalAuthorId} ${i}`, description: "Synthetic description text", assigneeId: admin.id } });
      await prisma.ticketMessage.createMany({ data: [{ ticketId: ticket.id, authorId: profile.userId, body: "author words" }, { ticketId: ticket.id, authorId: admin.id, body: "admin words" }] });
      await prisma.internalNote.create({ data: { ticketId: ticket.id, authorId: admin.id, body: "private" } });
      await prisma.ticketAssignment.create({ data: { ticketId: ticket.id, assigneeId: admin.id, assignedById: admin.id } });
      await prisma.aiAnalysis.create({ data: { ticketId: ticket.id, status: "FAILED", promptVersion: "v1", errorCode: "AI_RATE_LIMITED" } });
      const key = newKey();
      keys.push(key);
      writeFileSync(join(dir, key), "x");
      await prisma.ticketAttachment.create({ data: { ticketId: ticket.id, uploaderId: profile.userId, fileName: "a.txt", contentType: "text/plain", sizeBytes: 1, storageKey: key, sha256: "0".repeat(64) } });
      await prisma.auditLog.createMany({ data: [
        { actorId: admin.id, action: "ticket.reply.created", entityType: "Ticket", entityId: ticket.id, after: { x: 1 } },
        { actorId: profile.userId, action: "ticket.author_reply.created", entityType: "Ticket", entityId: ticket.id }
      ] });
    }
    await prisma.session.create({ data: { tokenHash: newKey(), userId: profile.userId, expiresAt: new Date(Date.now() + 3_600_000) } });
  }
  await prisma.session.create({ data: { tokenHash: newKey(), userId: admin.id, expiresAt: new Date(Date.now() + 3_600_000) } });

  const real = await prisma.user.create({ data: { email: "real.author@writers.test", passwordHash: await fastHash("Sturdy-Pass-2026"), role: "AUTHOR", authorProfile: { create: { externalAuthorId: "WEB-0123456789ABCDEF", name: "Real Author", phone: "", city: "", joinedDate: new Date("2026-10-16") } } }, include: { authorProfile: true } });
  const realTicket = await prisma.ticket.create({ data: { authorId: real.authorProfile!.id, subject: "Real question", description: "A genuine question from a real person" } });
  await prisma.ticketMessage.create({ data: { ticketId: realTicket.id, authorId: real.id, body: "real words" } });
  await prisma.auditLog.create({ data: { actorId: real.id, action: "user.registered", entityType: "User", entityId: real.id } });
  await prisma.auditLog.create({ data: { actorId: real.id, action: "ticket.created", entityType: "Ticket", entityId: realTicket.id } });
  await prisma.session.create({ data: { tokenHash: newKey(), userId: real.id, expiresAt: new Date(Date.now() + 3_600_000) } });
  return { admin, real, realTicket, keys };
}

describe("planCleanup (dry run)", () => {
  beforeEach(async () => { await populate(); });

  it("classifies exactly the synthetic records and protects the admin and real authors", async () => {
    const plan = await planCleanup(prisma);
    expect(plan.blockers).toEqual([]);
    expect(plan.excluded).toEqual([]);
    expect(plan.toDelete).toMatchObject({
      users: 10, authorProfiles: 10, books: 18, tickets: 4, ticketMessages: 8, internalNotes: 4, ticketAssignments: 4, aiAnalyses: 4,
      ticketAttachments: 4, auditLogs: 0, sessions: 2
    });
    expect(plan.auditRowsActorNulled).toBe(4);
    expect(plan.protectedAdminIds).toHaveLength(1);
    expect(plan.attachmentKeys).toHaveLength(4);
    expect(plan.token).toMatch(/^[a-f0-9]{16}$/);
    // The real author, their ticket, message, audit rows and session are all outside the deletion set.
    expect(plan.expectedAfter).toMatchObject({ users: 2, authorProfiles: 1, books: 0, tickets: 1, ticketMessages: 1, sessions: 2, auditLogs: 10 });
  });

  it("changes nothing", async () => {
    const before = await tableCounts(prisma);
    await planCleanup(prisma);
    await planCleanup(prisma);
    expect(await tableCounts(prisma)).toEqual(before);
  });

  it("is deterministic until the data changes, then the token changes", async () => {
    const a = await planCleanup(prisma);
    expect((await planCleanup(prisma)).token).toBe(a.token);
    const profile = await profileFor(prisma, "SYN-A003");
    await prisma.ticket.create({ data: { authorId: profile.id, subject: "New synthetic", description: "Synthetic description text" } });
    expect((await planCleanup(prisma)).token).not.toBe(a.token);
  });

  it("never selects the admin even if its email is placed on the whitelist", async () => {
    const plan = await planCleanup(prisma, [...SYNTHETIC_AUTHOR_EMAILS, ADMIN_EMAIL]);
    expect(plan.excluded).toHaveLength(1);
    expect(plan.excluded[0]!.reason).toMatch(/not AUTHOR/);
    expect(plan.userIds).not.toContain(plan.protectedAdminIds[0]);
    await expect(executeCleanup(prisma, { confirm: plan.token, backupStamp: BACKUP }, [...SYNTHETIC_AUTHOR_EMAILS, ADMIN_EMAIL])).resolves.toBeTruthy();
    expect(await prisma.user.count({ where: { email: ADMIN_EMAIL, role: "ADMIN" } })).toBe(1);
  });

  it("leaves a whitelisted email alone when its ids are not synthetic", async () => {
    const profile = await profileFor(prisma, "SYN-A004");
    await prisma.authorProfile.update({ where: { id: profile.id }, data: { externalAuthorId: "WEB-DEADBEEF00000000" } });
    const plan = await planCleanup(prisma);
    expect(plan.excluded).toEqual([{ userId: profile.userId, reason: "whitelisted email but external author id is not synthetic" }]);
    expect(plan.userIds).toHaveLength(9);
    await executeCleanup(prisma, { confirm: plan.token, backupStamp: BACKUP });
    expect(await prisma.user.count({ where: { id: profile.userId } })).toBe(1);
    expect(await prisma.book.count({ where: { authorId: profile.id } })).toBeGreaterThan(0);
  });

  it("blocks on records written by an unclassified user inside the synthetic set", async () => {
    const { real } = await populate();
    const synthetic = await prisma.ticket.findFirstOrThrow({ where: { subject: { startsWith: "Synthetic SYN-A001" } } });
    await prisma.ticketMessage.create({ data: { ticketId: synthetic.id, authorId: real.id, body: "a real person wrote here" } });
    const plan = await planCleanup(prisma);
    expect(plan.blockers.join(" ")).toMatch(/message\(s\) on synthetic tickets were written by an unclassified user/);
    const before = await tableCounts(prisma);
    await expect(executeCleanup(prisma, { confirm: plan.token, backupStamp: BACKUP })).rejects.toThrow(/blocked/);
    expect(await tableCounts(prisma)).toEqual(before);
  });

  it("cannot meet a cross-author book reference: the database already forbids it, so the planner has nothing to block on", async () => {
    const { real } = await populate();
    const book = await prisma.book.findFirstOrThrow({ where: { externalBookId: "SYN-B001" } });
    await expect(prisma.ticket.create({ data: { authorId: real.authorProfile!.id, bookId: book.id, subject: "Mentions a book", description: "Pointing at a synthetic book" } }))
      .rejects.toThrow(/must belong to the ticket author/);
    expect((await planCleanup(prisma)).blockers).toEqual([]);
  });

  it("reports attachment files without removing them, including files no row refers to", async () => {
    const stray = newKey();
    writeFileSync(join(dir, stray), "orphan");
    const plan = await planCleanup(prisma);
    const report = await inspectAttachmentFiles(prisma, dir, plan.attachmentKeys);
    expect(report).toEqual({ directoryReadable: true, present: 4, missing: 0, unreferencedFiles: 1 });
    expect(existsSync(join(dir, stray))).toBe(true);
    expect(await inspectAttachmentFiles(prisma, join(dir, "nope"), plan.attachmentKeys)).toMatchObject({ directoryReadable: false });
  });
});

describe("executeCleanup", () => {
  it("deletes only the previewed synthetic records, verifies counts and keeps the admin and real data", async () => {
    const { admin, real, realTicket, keys } = await populate();
    const plan = await planCleanup(prisma);
    const auditBefore = await prisma.auditLog.findMany({ orderBy: { id: "asc" } });
    const result = await executeCleanup(prisma, { confirm: plan.token, backupStamp: BACKUP });

    for (const table of TABLES) expect(result.deleted[table]).toBe(plan.toDelete[table]);
    expect(await prisma.user.findMany({ select: { id: true }, orderBy: { id: "asc" } })).toEqual([{ id: admin.id }, { id: real.id }].sort((a, b) => a.id.localeCompare(b.id)));
    expect(await prisma.book.count()).toBe(0);
    expect(await prisma.ticket.findMany({ select: { id: true } })).toEqual([{ id: realTicket.id }]);
    expect(await prisma.ticketMessage.count()).toBe(1);
    expect(await prisma.authorProfile.count()).toBe(1);
    // Sessions: the admin's and the real author's survive, the synthetic authors' are gone.
    expect(await prisma.session.count()).toBe(2);
    // The audit log is evidence and is never deleted or rewritten: every earlier row is still there with identical content
    // (the only difference is actorId = NULL where the actor was a deleted synthetic user, which the append-only trigger permits).
    const auditAfter = await prisma.auditLog.findMany({ where: { action: { not: "maintenance.synthetic_cleanup" } }, orderBy: { id: "asc" } });
    expect(auditAfter).toHaveLength(auditBefore.length);
    for (const [i, row] of auditAfter.entries()) {
      const was = auditBefore[i]!;
      expect({ ...row, actorId: 0 }).toEqual({ ...was, actorId: 0 });
      expect(row.actorId === was.actorId || row.actorId === null).toBe(true);
    }
    expect(auditAfter.filter((r, i) => r.actorId !== auditBefore[i]!.actorId)).toHaveLength(4);
    expect(await prisma.auditLog.count({ where: { action: "maintenance.synthetic_cleanup" } })).toBe(1);
    const evidence = await prisma.auditLog.findFirstOrThrow({ where: { action: "maintenance.synthetic_cleanup" } });
    expect(evidence.actorId).toBeNull();
    expect(JSON.stringify(evidence.after)).toContain(BACKUP);
    expect(JSON.stringify(evidence.after)).not.toMatch(/words|private|description/);
    expect(result.after.auditLogs).toBe(auditBefore.length + 1);

    // Files go only after commit, by key; the second call shows missing files are tolerated.
    expect((await deleteAttachmentFiles(dir, plan.attachmentKeys)).removed).toBe(4);
    for (const key of keys) expect(existsSync(join(dir, key))).toBe(false);
    expect((await deleteAttachmentFiles(dir, plan.attachmentKeys)).removed).toBe(4);

    // The admin still works and the real author still works.
    expect((await request(app).post("/api/v1/auth/login").set("Origin", WEB_ORIGIN).send({ email: ADMIN_EMAIL, password: TEST_PASSWORD })).status).toBe(200);
    expect((await request(app).post("/api/v1/auth/login").set("Origin", WEB_ORIGIN).send({ email: "real.author@writers.test", password: "Sturdy-Pass-2026" })).status).toBe(200);
    // Synthetic logins no longer exist.
    expect((await request(app).post("/api/v1/auth/login").set("Origin", WEB_ORIGIN).send({ email: loadSyntheticDataset()[0]!.email, password: TEST_PASSWORD })).status).toBe(401);
  });

  it("is idempotent: a second run has nothing to do and changes nothing", async () => {
    await populate();
    const plan = await planCleanup(prisma);
    await executeCleanup(prisma, { confirm: plan.token, backupStamp: BACKUP });
    const before = await tableCounts(prisma);
    const again = await planCleanup(prisma);
    expect(again.userIds).toEqual([]);
    await expect(executeCleanup(prisma, { confirm: again.token, backupStamp: BACKUP })).rejects.toThrow(/nothing to clean up/);
    expect(await tableCounts(prisma)).toEqual(before);
  });

  it("refuses a stale or wrong token and a bad backup stamp, leaving the data untouched", async () => {
    await populate();
    const plan = await planCleanup(prisma);
    const before = await tableCounts(prisma);
    await expect(executeCleanup(prisma, { confirm: "0".repeat(16), backupStamp: BACKUP })).rejects.toThrow(/token mismatch/);
    await expect(executeCleanup(prisma, { confirm: "nope", backupStamp: BACKUP })).rejects.toBeInstanceOf(CleanupError);
    await expect(executeCleanup(prisma, { confirm: plan.token, backupStamp: "yesterday" })).rejects.toThrow(/backup stamp/);
    // Data changes between preview and execution: the approved preview no longer describes reality.
    const profile = await profileFor(prisma, "SYN-A005");
    await prisma.ticket.create({ data: { authorId: profile.id, subject: "Late arrival", description: "Synthetic description text" } });
    await expect(executeCleanup(prisma, { confirm: plan.token, backupStamp: BACKUP })).rejects.toThrow(/token mismatch/);
    expect(await tableCounts(prisma)).toEqual({ ...before, tickets: before.tickets + 1 });
  });

  it("rolls everything back if any step fails part-way", async () => {
    await populate();
    const plan = await planCleanup(prisma);
    const before = await tableCounts(prisma);
    await prisma.$executeRawUnsafe(`CREATE FUNCTION "test_block_book_delete"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated failure'; END; $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER "test_block_book_delete" BEFORE DELETE ON "Book" FOR EACH ROW EXECUTE FUNCTION "test_block_book_delete"()`);
    try {
      await expect(executeCleanup(prisma, { confirm: plan.token, backupStamp: BACKUP })).rejects.toThrow();
      // Tickets (and their cascades) were already deleted inside the transaction when the book delete failed; none of that may persist.
      expect(await tableCounts(prisma)).toEqual(before);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER "test_block_book_delete" ON "Book"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION "test_block_book_delete"()`);
    }
  });
});

describe("attachment file safety", () => {
  it("only ever touches 48-character hex keys inside the directory", async () => {
    const outside = join(dir, "..", `outside-${randomBytes(4).toString("hex")}`);
    writeFileSync(outside, "keep me");
    try {
      for (const bad of ["../" + outside, "..", "a/b", "%2e%2e%2fsecret", "ABCDEF".repeat(8), newKey() + "0", ""]) {
        await expect(deleteAttachmentFiles(dir, [bad])).rejects.toBeInstanceOf(CleanupError);
      }
      expect(existsSync(outside)).toBe(true);
    } finally {
      rmSync(outside, { force: true });
    }
  });
});

describe("production seed guard", () => {
  afterEach(async () => { await resetDatabase(prisma); });
  const dataset = () => loadSyntheticDataset();

  it("recognises the synthetic dataset", () => {
    expect(isSyntheticDataset(dataset())).toBe(true);
  });

  it("refuses to seed synthetic accounts when NODE_ENV=production, even with otherwise valid credentials", async () => {
    await resetDatabase(prisma);
    await expect(importSeedData(prisma, dataset(), {
      credentials: { authorPassword: TEST_PASSWORD, adminEmail: ADMIN_EMAIL, adminPassword: TEST_PASSWORD }, hash: fastHash, env: { NODE_ENV: "production" }
    })).rejects.toBeInstanceOf(SeedConflictError);
    expect(await prisma.user.count()).toBe(0);
    expect(() => assertSeedAllowed(dataset(), { NODE_ENV: "production", BOOKLEAF_ALLOW_SYNTHETIC_SEED: "true" })).toThrow(/production/);
  });

  it("allows it only with the explicit acknowledgement, and always outside production", async () => {
    expect(() => assertSeedAllowed(dataset(), { NODE_ENV: "production", BOOKLEAF_ALLOW_SYNTHETIC_SEED: "yes-i-understand" })).not.toThrow();
    expect(() => assertSeedAllowed(dataset(), { NODE_ENV: "development" })).not.toThrow();
    expect(() => assertSeedAllowed(dataset(), {})).not.toThrow();
  });
});

describe("admin tool", () => {
  beforeEach(async () => { await resetDatabase(prisma); });
  const strong = "Admin-Pass-2026x";

  it("creates an ADMIN with an Argon2id hash, an audit record, and no author profile", async () => {
    const result = await ensureAdmin(prisma, { email: "  Ops@Company.test ", password: strong, hash: fastHash });
    expect(result.action).toBe("created");
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "ops@company.test" }, include: { authorProfile: true } });
    expect(user.role).toBe("ADMIN");
    expect(user.authorProfile).toBeNull();
    expect(user.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "admin.created", entityId: user.id } })).toBe(1);
    expect((await request(app).post("/api/v1/auth/login").set("Origin", WEB_ORIGIN).send({ email: "ops@company.test", password: strong })).status).toBe(200);
  });

  it("rejects weak passwords, bad emails, and re-creation without the explicit rotate flag", async () => {
    await expect(ensureAdmin(prisma, { email: "ops@company.test", password: "short", hash: fastHash })).rejects.toBeInstanceOf(AdminError);
    await expect(ensureAdmin(prisma, { email: "not-an-email", password: strong, hash: fastHash })).rejects.toBeInstanceOf(AdminError);
    await ensureAdmin(prisma, { email: "ops@company.test", password: strong, hash: fastHash });
    await expect(ensureAdmin(prisma, { email: "ops@company.test", password: "Another-Pass-2026y", hash: fastHash })).rejects.toThrow(/rotate/);
    expect((await request(app).post("/api/v1/auth/login").set("Origin", WEB_ORIGIN).send({ email: "ops@company.test", password: strong })).status).toBe(200);
  });

  it("rotates a password, ending the admin's existing sessions", async () => {
    const created = await ensureAdmin(prisma, { email: "ops@company.test", password: strong, hash: fastHash });
    await prisma.session.create({ data: { tokenHash: newKey(), userId: created.userId, expiresAt: new Date(Date.now() + 3_600_000) } });
    const next = "Rotated-Pass-2026z";
    const rotated = await ensureAdmin(prisma, { email: "ops@company.test", password: next, rotatePassword: true, hash: fastHash });
    expect(rotated).toMatchObject({ action: "password-rotated", sessionsRevoked: 1 });
    expect(await prisma.session.count({ where: { userId: created.userId } })).toBe(0);
    expect((await request(app).post("/api/v1/auth/login").set("Origin", WEB_ORIGIN).send({ email: "ops@company.test", password: strong })).status).toBe(401);
    expect((await request(app).post("/api/v1/auth/login").set("Origin", WEB_ORIGIN).send({ email: "ops@company.test", password: next })).status).toBe(200);
  });

  it("never promotes an author to admin", async () => {
    await seedSynthetic(prisma);
    await expect(ensureAdmin(prisma, { email: loadSyntheticDataset()[0]!.email, password: strong, rotatePassword: true, hash: fastHash })).rejects.toThrow(/never promoted/);
    expect(await prisma.user.count({ where: { role: "ADMIN" } })).toBe(1);
  });
});
