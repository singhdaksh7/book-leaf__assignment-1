import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { adminTicketDetailResponseSchema, assignmentResponseSchema, internalNoteResponseSchema, ticketDetailResponseSchema, ticketMessageResponseSchema } from "@bookleaf/contracts";
import { PrismaClient } from "@bookleaf/db";
import { ADMIN_EMAIL, TEST_PASSWORD, WEB_ORIGIN, createTestApp, fastHash, loadSyntheticDataset, login, makeTicket, mutate, profileFor, resetDatabase, seedSynthetic } from "./helpers.js";

const prisma = new PrismaClient();
const { app, config } = createTestApp(prisma);
const [authorA, authorB] = loadSyntheticDataset();
const NOTE = "INTERNAL-NOTE-SECRET-4711";

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "test_fail_audit" ON "AuditLog"`);
  await resetDatabase(prisma);
  await seedSynthetic(prisma);
});
afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "test_fail_audit" ON "AuditLog"`);
  await prisma.$disconnect();
});

const admin = () => login(app, config, ADMIN_EMAIL);
async function ticketFor(author = authorA!) {
  return makeTicket(prisma, (await profileFor(prisma, author.author_id)).id, { subject: "Conversation subject" });
}

describe("admin replies", () => {
  it("sends an author-visible message, bumps the ticket, audits the action and leaves status alone", async () => {
    const ticket = await ticketFor();
    const a = await admin();
    const response = await mutate(a, "post", `/api/v1/admin/tickets/${ticket.id}/replies`).send({ body: "  Thanks for writing in.  " });
    expect(response.status).toBe(201);
    const { message } = ticketMessageResponseSchema.parse(response.body);
    expect(message).toMatchObject({ ticketId: ticket.id, body: "Thanks for writing in.", visibility: "AUTHOR" });
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    expect(message.authorId).toBe(adminUser.id);

    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(after.status).toBe("OPEN");
    expect(after.updatedAt.getTime()).toBeGreaterThan(ticket.updatedAt.getTime());
    const audit = await prisma.auditLog.findMany();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "ticket.reply.created", entityId: ticket.id, actorId: adminUser.id, after: { messageId: message.id, visibility: "AUTHOR" } });
    expect(JSON.stringify(audit)).not.toContain("Thanks for writing in");
  });

  it("shows the reply to the owning author in order, and only to them", async () => {
    const ticket = await ticketFor();
    const a = await admin();
    for (const body of ["First reply", "Second reply", "Third reply"]) {
      expect((await mutate(a, "post", `/api/v1/admin/tickets/${ticket.id}/replies`).send({ body })).status).toBe(201);
    }
    const owner = await login(app, config, authorA!.email);
    const detail = ticketDetailResponseSchema.parse((await owner.agent.get(`/api/v1/author/tickets/${ticket.id}`)).body);
    expect(detail.messages.map((m) => m.body)).toEqual(["First reply", "Second reply", "Third reply"]);
    const times = detail.messages.map((m) => Date.parse(m.createdAt));
    expect([...times].sort((x, y) => x - y)).toEqual(times);

    const other = await login(app, config, authorB!.email);
    const foreign = await other.agent.get(`/api/v1/author/tickets/${ticket.id}`);
    expect(foreign.status).toBe(404);
    expect(JSON.stringify(foreign.body)).not.toContain("First reply");
  });

  it("validates input and ticket state", async () => {
    const ticket = await ticketFor();
    const a = await admin();
    const url = `/api/v1/admin/tickets/${ticket.id}/replies`;
    for (const body of [{}, { body: "" }, { body: "   " }, { body: "x".repeat(10_001) }, { body: 5 }]) {
      expect((await mutate(a, "post", url).send(body as object)).status, JSON.stringify(body).slice(0, 30)).toBe(400);
    }
    expect((await mutate(a, "post", "/api/v1/admin/tickets/missing/replies").send({ body: "hi" })).status).toBe(404);
    await prisma.ticket.update({ where: { id: ticket.id }, data: { status: "CLOSED" } });
    const closed = await mutate(a, "post", url).send({ body: "too late" });
    expect(closed.status).toBe(409);
    expect(await prisma.ticketMessage.count()).toBe(0);
  });

  it("enforces authentication, role and CSRF", async () => {
    const ticket = await ticketFor();
    const url = `/api/v1/admin/tickets/${ticket.id}/replies`;
    expect((await request(app).post(url).set("Origin", WEB_ORIGIN).send({ body: "hi" })).status).toBe(401);
    const author = await login(app, config, authorA!.email);
    expect((await mutate(author, "post", url).send({ body: "I am not an admin" })).status).toBe(403);
    const a = await admin();
    expect((await a.agent.post(url).set("Origin", WEB_ORIGIN).send({ body: "no csrf" })).status).toBe(403);
    expect((await a.agent.post(url).set("Origin", WEB_ORIGIN).set("X-CSRF-Token", author.csrf).send({ body: "wrong csrf" })).status).toBe(403);
    expect((await a.agent.post(url).set("Origin", "https://evil.example.com").set("X-CSRF-Token", a.csrf).send({ body: "evil origin" })).status).toBe(403);
    expect(await prisma.ticketMessage.count()).toBe(0);
  });

  it("treats a retried identical reply as the same message, including concurrent retries", async () => {
    const ticket = await ticketFor();
    const a = await admin();
    const url = `/api/v1/admin/tickets/${ticket.id}/replies`;
    const first = await mutate(a, "post", url).send({ body: "Retry me" });
    const retry = await mutate(a, "post", url).send({ body: "Retry me" });
    expect(retry.status).toBe(201);
    expect(retry.body.message.id).toBe(first.body.message.id);

    const burst = await Promise.all(Array.from({ length: 6 }, () => mutate(a, "post", url).send({ body: "Burst reply" })));
    expect(new Set(burst.map((r) => r.body.message.id)).size).toBe(1);
    expect(await prisma.ticketMessage.count()).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: "ticket.reply.created" } })).toBe(2);

    // A different message, or the same text long after, is genuinely new.
    expect((await mutate(a, "post", url).send({ body: "Different" })).body.message.id).not.toBe(first.body.message.id);
    await prisma.ticketMessage.updateMany({ data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
    expect((await mutate(a, "post", url).send({ body: "Retry me" })).body.message.id).not.toBe(first.body.message.id);
  });

  it("is atomic: a failing audit write leaves no message behind", async () => {
    const ticket = await ticketFor();
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION "test_fail_audit_fn"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END; $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER "test_fail_audit" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "test_fail_audit_fn"()`);
    const a = await admin();
    const response = await mutate(a, "post", `/api/v1/admin/tickets/${ticket.id}/replies`).send({ body: "Should not persist" });
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(response.body)).not.toMatch(/audit unavailable/);
    expect(await prisma.ticketMessage.count()).toBe(0);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).updatedAt.getTime()).toBe(ticket.updatedAt.getTime());
  });
});

describe("internal notes", () => {
  it("are created by admins, shown only in admin detail, and never reach any author response", async () => {
    const ticket = await ticketFor();
    const a = await admin();
    const created = await mutate(a, "post", `/api/v1/admin/tickets/${ticket.id}/internal-notes`).send({ body: NOTE });
    expect(created.status).toBe(201);
    expect(internalNoteResponseSchema.parse(created.body).note).toMatchObject({ ticketId: ticket.id, body: NOTE });

    const detail = adminTicketDetailResponseSchema.parse((await a.agent.get(`/api/v1/admin/tickets/${ticket.id}`)).body);
    expect(detail.internalNotes.map((n) => n.body)).toEqual([NOTE]);
    expect(detail.messages).toEqual([]); // a note is not a message

    const owner = await login(app, config, authorA!.email);
    await mutate(a, "post", `/api/v1/admin/tickets/${ticket.id}/replies`).send({ body: "Public reply" });
    for (const url of ["/api/v1/author/tickets", `/api/v1/author/tickets/${ticket.id}`, `/api/v1/author/tickets/${ticket.id}/attachments`, "/api/v1/auth/me", "/api/v1/author/books"]) {
      const response = await owner.agent.get(url);
      expect(JSON.stringify(response.body), url).not.toContain("4711");
      expect(JSON.stringify(response.body), url).not.toMatch(/internalNote/i);
    }
    // And the audit trail records that a note exists without copying its text.
    expect(JSON.stringify(await prisma.auditLog.findMany())).not.toContain("4711");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "ticket.internal_note.created" } });
    expect(audit.after).toEqual({ noteId: created.body.note.id });
  });

  it("rejects authors, anonymous callers, missing CSRF and bad input; dedupes retries", async () => {
    const ticket = await ticketFor();
    const url = `/api/v1/admin/tickets/${ticket.id}/internal-notes`;
    const owner = await login(app, config, authorA!.email);
    expect((await mutate(owner, "post", url).send({ body: "author attempt" })).status).toBe(403);
    expect((await request(app).post(url).set("Origin", WEB_ORIGIN).send({ body: "anon" })).status).toBe(401);
    const a = await admin();
    expect((await a.agent.post(url).set("Origin", WEB_ORIGIN).send({ body: "no csrf" })).status).toBe(403);
    for (const body of [{}, { body: " " }, { body: "n".repeat(10_001) }]) expect((await mutate(a, "post", url).send(body as object)).status).toBe(400);
    expect((await mutate(a, "post", "/api/v1/admin/tickets/missing/internal-notes").send({ body: "x" })).status).toBe(404);
    expect(await prisma.internalNote.count()).toBe(0);

    const first = await mutate(a, "post", url).send({ body: "Same note" });
    const burst = await Promise.all(Array.from({ length: 4 }, () => mutate(a, "post", url).send({ body: "Same note" })));
    expect(burst.every((r) => r.body.note.id === first.body.note.id)).toBe(true);
    expect(await prisma.internalNote.count()).toBe(1);
  });

  it("do not change the ticket as the author sees it", async () => {
    const ticket = await ticketFor();
    const a = await admin();
    await mutate(a, "post", `/api/v1/admin/tickets/${ticket.id}/internal-notes`).send({ body: NOTE });
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).updatedAt.getTime()).toBe(ticket.updatedAt.getTime());
  });
});

describe("assignment", () => {
  const put = (client: Awaited<ReturnType<typeof admin>>, ticketId: string, body: unknown) => mutate(client, "put", `/api/v1/admin/tickets/${ticketId}/assignment`).send(body as object);

  it("assigns to self, records history and audit, and is idempotent", async () => {
    const ticket = await ticketFor();
    const a = await admin();
    const me = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    const response = await put(a, ticket.id, { assigneeId: me.id });
    expect(response.status).toBe(200);
    const parsed = assignmentResponseSchema.parse(response.body);
    expect(parsed.ticket.assigneeId).toBe(me.id);
    expect(parsed.assignment).toMatchObject({ ticketId: ticket.id, assigneeId: me.id, assignedById: me.id });

    const again = await put(a, ticket.id, { assigneeId: me.id });
    expect(again.status).toBe(200);
    expect(again.body.assignment.id).toBe(parsed.assignment.id);
    expect(await prisma.ticketAssignment.count()).toBe(1);
    const audit = await prisma.auditLog.findMany();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "ticket.assignment.updated", before: { assigneeId: null }, after: { assigneeId: me.id }, actorId: me.id });
  });

  it("only allows assigning to yourself", async () => {
    const ticket = await ticketFor();
    const other = await prisma.user.create({ data: { email: "second.admin@example.test", role: "ADMIN", passwordHash: await fastHash(TEST_PASSWORD) } });
    const a = await admin();
    const response = await put(a, ticket.id, { assigneeId: other.id });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
    expect((await put(a, ticket.id, { assigneeId: "nobody" })).status).toBe(403);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).assigneeId).toBeNull();
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it("can be released, and releasing an unassigned ticket is a conflict", async () => {
    const ticket = await ticketFor();
    const a = await admin();
    const me = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    expect((await put(a, ticket.id, { assigneeId: null })).status).toBe(409);
    await put(a, ticket.id, { assigneeId: me.id });
    const released = await put(a, ticket.id, { assigneeId: null });
    expect(released.status).toBe(200);
    expect(released.body.ticket.assigneeId).toBeNull();
    expect(released.body.assignment.assigneeId).toBeNull();
    expect(await prisma.ticketAssignment.count()).toBe(2);
    const detail = await a.agent.get(`/api/v1/admin/tickets/${ticket.id}`);
    expect(detail.body.assignments.map((x: { assigneeId: string | null }) => x.assigneeId)).toEqual([me.id, null]);
  });

  it("validates, authorises and rejects closed tickets", async () => {
    const ticket = await ticketFor();
    const a = await admin();
    const me = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    for (const body of [{}, { assigneeId: "" }, { assigneeId: 5 }]) expect((await put(a, ticket.id, body)).status).toBe(400);
    expect((await put(a, "missing", { assigneeId: me.id })).status).toBe(404);
    const owner = await login(app, config, authorA!.email);
    expect((await put(owner, ticket.id, { assigneeId: me.id })).status).toBe(403);
    expect((await request(app).put(`/api/v1/admin/tickets/${ticket.id}/assignment`).set("Origin", WEB_ORIGIN).send({ assigneeId: me.id })).status).toBe(401);
    expect((await a.agent.put(`/api/v1/admin/tickets/${ticket.id}/assignment`).set("Origin", WEB_ORIGIN).send({ assigneeId: me.id })).status).toBe(403); // CSRF
    await prisma.ticket.update({ where: { id: ticket.id }, data: { status: "CLOSED" } });
    expect((await put(a, ticket.id, { assigneeId: me.id })).status).toBe(409);
  });

  it("is atomic: a failing audit write leaves ticket and history untouched", async () => {
    const ticket = await ticketFor();
    const me = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION "test_fail_audit_fn"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END; $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER "test_fail_audit" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "test_fail_audit_fn"()`);
    const a = await admin();
    expect((await put(a, ticket.id, { assigneeId: me.id })).status).toBe(500);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).assigneeId).toBeNull();
    expect(await prisma.ticketAssignment.count()).toBe(0);
  });

  it("serialises concurrent assignment requests into one change", async () => {
    const ticket = await ticketFor();
    const a = await admin();
    const me = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    const results = await Promise.all(Array.from({ length: 5 }, () => put(a, ticket.id, { assigneeId: me.id })));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await prisma.ticketAssignment.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "ticket.assignment.updated" } })).toBe(1);
  });
});

describe("audit trail and queue stability", () => {
  it("records the whole administrative sequence in order without private values", async () => {
    const ticket = await ticketFor();
    const a = await admin();
    const me = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    await put(a, ticket.id, { assigneeId: me.id });
    await mutate(a, "patch", `/api/v1/admin/tickets/${ticket.id}`).send({ status: "IN_PROGRESS", priority: "HIGH" });
    await mutate(a, "post", `/api/v1/admin/tickets/${ticket.id}/internal-notes`).send({ body: NOTE });
    await mutate(a, "post", `/api/v1/admin/tickets/${ticket.id}/replies`).send({ body: "Reply text that must not be audited" });
    const detail = await a.agent.get(`/api/v1/admin/tickets/${ticket.id}`);
    expect(detail.body.auditEvents.map((e: { action: string }) => e.action).sort()).toEqual([
      "ticket.assignment.updated", "ticket.internal_note.created", "ticket.priority.updated", "ticket.reply.created", "ticket.status.updated"
    ]);
    expect(detail.body.auditEvents.every((e: { actorId: string; requestId: string | null }) => e.actorId === me.id && typeof e.requestId === "string")).toBe(true);
    const text = JSON.stringify(detail.body.auditEvents);
    expect(text).not.toMatch(/"before"|"after"|4711|must not be audited/);

    function put(client: typeof a, id: string, body: unknown) { return mutate(client, "put", `/api/v1/admin/tickets/${id}/assignment`).send(body as object); }
  });

  it("keeps the unresolved queue order unaffected by replies and notes", async () => {
    const pa = await profileFor(prisma, authorA!.author_id);
    const base = Date.UTC(2026, 0, 1);
    const old = await makeTicket(prisma, pa.id, { subject: "old", priority: "HIGH", createdAt: new Date(base) });
    const recent = await makeTicket(prisma, pa.id, { subject: "recent", priority: "HIGH", createdAt: new Date(base + 86_400_000) });
    const a = await admin();
    const order = async () => (await a.agent.get("/api/v1/admin/tickets")).body.items.map((t: { subject: string }) => t.subject);
    expect(await order()).toEqual(["old", "recent"]);
    await mutate(a, "post", `/api/v1/admin/tickets/${old.id}/replies`).send({ body: "touching the old ticket" });
    await mutate(a, "post", `/api/v1/admin/tickets/${recent.id}/internal-notes`).send({ body: "note" });
    expect(await order()).toEqual(["old", "recent"]);
  });
});
