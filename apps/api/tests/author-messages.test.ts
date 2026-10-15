import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { adminTicketDetailResponseSchema, apiErrorSchema, ticketDetailResponseSchema, ticketMessageResponseSchema } from "@bookleaf/contracts";
import { PrismaClient } from "@bookleaf/db";
import { TicketEventHub } from "../src/events/hub.js";
import { ADMIN_EMAIL, WEB_ORIGIN, cookieValue, createTestApp, loadSyntheticDataset, login, makeTicket, mutate, profileFor, resetDatabase, seedSynthetic } from "./helpers.js";
import { openStream, sleep, startServer, type SseClient } from "./m3helpers.js";

const prisma = new PrismaClient();
const [authorA, authorB] = loadSyntheticDataset();
const events = new TicketEventHub();
const { app, config } = createTestApp(prisma, { AUTHOR_REPLY_LIMIT_PER_HOUR: "1000" }, { events, sseHeartbeatMs: 5000 });
let server: Awaited<ReturnType<typeof startServer>>;
const open: SseClient[] = [];

beforeAll(async () => {
  server = await startServer(app);
});
beforeEach(async () => {
  open.splice(0).forEach((c) => c.close());
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "test_fail_audit" ON "AuditLog"`);
  await resetDatabase(prisma);
  await seedSynthetic(prisma);
});
afterAll(async () => {
  open.splice(0).forEach((c) => c.close());
  events.closeAll();
  await server.close();
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "test_fail_audit" ON "AuditLog"`);
  await prisma.$disconnect();
});

const ticketFor = async (author = authorA!) => makeTicket(prisma, (await profileFor(prisma, author.author_id)).id, { subject: "Conversation" });
const post = (client: Awaited<ReturnType<typeof login>>, ticketId: string, body: unknown) => mutate(client, "post", `/api/v1/author/tickets/${ticketId}/messages`).send(body as object);
const authorUser = async (author = authorA!) => prisma.user.findUniqueOrThrow({ where: { email: author.email } });

describe("POST /author/tickets/:id/messages", () => {
  it("persists an author-visible message, bumps the ticket and returns the contract shape", async () => {
    const ticket = await ticketFor();
    const a = await login(app, config, authorA!.email);
    const response = await post(a, ticket.id, { body: "  Here is the extra detail you asked for.  " });
    expect(response.status).toBe(201);
    const { message } = ticketMessageResponseSchema.parse(response.body);
    const user = await authorUser();
    expect(message).toMatchObject({ ticketId: ticket.id, authorId: user.id, body: "Here is the extra detail you asked for.", visibility: "AUTHOR" });
    expect(Object.keys(response.body)).toEqual(["message"]);

    const row = await prisma.ticketMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(row).toMatchObject({ authorId: user.id, visibility: "AUTHOR", body: "Here is the extra detail you asked for." });
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(after.updatedAt.getTime()).toBeGreaterThan(ticket.updatedAt.getTime());
    expect(after).toMatchObject({ status: "OPEN", category: null, priority: null, assigneeId: null }); // nothing else moves
  });

  it("writes one audit row for the author without copying the text", async () => {
    const ticket = await ticketFor();
    const a = await login(app, config, authorA!.email);
    const response = await mutate(a, "post", `/api/v1/author/tickets/${ticket.id}/messages`).set("X-Request-Id", "author-msg-0001").send({ body: "AUDIT-TEXT-MUST-NOT-APPEAR" });
    const audit = await prisma.auditLog.findMany();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "ticket.author_reply.created", entityType: "Ticket", entityId: ticket.id, actorId: (await authorUser()).id,
      after: { messageId: response.body.message.id, visibility: "AUTHOR" }, requestId: "author-msg-0001"
    });
    expect(JSON.stringify(audit)).not.toContain("AUDIT-TEXT-MUST-NOT-APPEAR");
  });

  it("is visible to admins in the existing conversation, interleaved in order with admin replies", async () => {
    const ticket = await ticketFor();
    const a = await login(app, config, authorA!.email);
    const admin = await login(app, config, ADMIN_EMAIL);
    expect((await post(a, ticket.id, { body: "1 author question" })).status).toBe(201);
    await sleep(15);
    expect((await mutate(admin, "post", `/api/v1/admin/tickets/${ticket.id}/replies`).send({ body: "2 admin answer" })).status).toBe(201);
    await sleep(15);
    expect((await post(a, ticket.id, { body: "3 author follow-up" })).status).toBe(201);

    const adminView = adminTicketDetailResponseSchema.parse((await admin.agent.get(`/api/v1/admin/tickets/${ticket.id}`)).body);
    expect(adminView.messages.map((m) => m.body)).toEqual(["1 author question", "2 admin answer", "3 author follow-up"]);
    const authorUserRow = await authorUser();
    expect(adminView.messages.map((m) => m.authorId === authorUserRow.id)).toEqual([true, false, true]);
    expect(adminView.messages.every((m) => m.visibility === "AUTHOR")).toBe(true);
    expect(adminView.internalNotes).toEqual([]);

    const authorView = ticketDetailResponseSchema.parse((await a.agent.get(`/api/v1/author/tickets/${ticket.id}`)).body);
    expect(authorView.messages.map((m) => m.body)).toEqual(["1 author question", "2 admin answer", "3 author follow-up"]);
    const times = authorView.messages.map((m) => Date.parse(m.createdAt));
    expect([...times].sort((x, y) => x - y)).toEqual(times);
  });

  it("preserves the admin reply behaviour (still the only admin send path, still idempotent)", async () => {
    const ticket = await ticketFor();
    const admin = await login(app, config, ADMIN_EMAIL);
    const url = `/api/v1/admin/tickets/${ticket.id}/replies`;
    const first = await mutate(admin, "post", url).send({ body: "Admin reply" });
    const retry = await mutate(admin, "post", url).send({ body: "Admin reply" });
    expect(first.status).toBe(201);
    expect(retry.body.message.id).toBe(first.body.message.id);
    expect((await prisma.auditLog.findMany()).map((a) => a.action)).toEqual(["ticket.reply.created"]);
  });

  it("cannot be used to create internal notes, admin-only messages or AI drafts", async () => {
    const ticket = await ticketFor();
    const a = await login(app, config, authorA!.email);
    const response = await post(a, ticket.id, {
      body: "Please read this", visibility: "ADMIN", internal: true, note: "secret", internalNote: "secret", authorId: "someone-else", aiAnalysis: { draftResponse: "forged draft" },
      status: "CLOSED", priority: "CRITICAL", ticketId: "other"
    });
    expect(response.status).toBe(201);
    expect(response.body.message.visibility).toBe("AUTHOR");
    expect(response.body.message.authorId).toBe((await authorUser()).id);
    expect(response.body.message.ticketId).toBe(ticket.id);
    expect(await prisma.ticketMessage.count({ where: { visibility: "ADMIN" } })).toBe(0);
    expect(await prisma.internalNote.count()).toBe(0);
    expect(await prisma.aiAnalysis.count()).toBe(0);
    expect(await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).toMatchObject({ status: "OPEN", priority: null });
    const admin = await login(app, config, ADMIN_EMAIL);
    expect(JSON.stringify((await admin.agent.get(`/api/v1/admin/tickets/${ticket.id}`)).body)).not.toContain("forged draft");
  });
});

describe("ownership and authorisation", () => {
  it("returns the same 404 for another author's ticket as for a missing one, and stores nothing", async () => {
    const theirs = await ticketFor(authorA!);
    const b = await login(app, config, authorB!.email);
    const foreign = await post(b, theirs.id, { body: "I should not be able to write here" });
    const missing = await post(b, "does-not-exist", { body: "I should not be able to write here" });
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body.error.message).toBe(missing.body.error.message);
    expect(apiErrorSchema.parse(foreign.body).error.code).toBe("NOT_FOUND");
    expect(await prisma.ticketMessage.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: theirs.id } })).updatedAt.getTime()).toBe(theirs.updatedAt.getTime());
  });

  it("requires authentication and the AUTHOR role", async () => {
    const ticket = await ticketFor();
    const url = `/api/v1/author/tickets/${ticket.id}/messages`;
    expect((await request(app).post(url).set("Origin", WEB_ORIGIN).send({ body: "anonymous" })).status).toBe(401);
    const admin = await login(app, config, ADMIN_EMAIL);
    expect((await mutate(admin, "post", url).send({ body: "admin through the author route" })).status).toBe(403);
    expect(await prisma.ticketMessage.count()).toBe(0);
  });

  it("enforces CSRF and origin", async () => {
    const ticket = await ticketFor();
    const url = `/api/v1/author/tickets/${ticket.id}/messages`;
    const a = await login(app, config, authorA!.email);
    const b = await login(app, config, authorB!.email);
    expect((await a.agent.post(url).set("Origin", WEB_ORIGIN).send({ body: "no token" })).status).toBe(403);
    expect((await a.agent.post(url).set("Origin", WEB_ORIGIN).set("X-CSRF-Token", "forged").send({ body: "forged" })).status).toBe(403);
    expect((await a.agent.post(url).set("Origin", WEB_ORIGIN).set("X-CSRF-Token", b.csrf).send({ body: "another session's token" })).status).toBe(403);
    expect((await a.agent.post(url).set("Origin", "https://evil.example.com").set("X-CSRF-Token", a.csrf).send({ body: "evil origin" })).status).toBe(403);
    expect(await prisma.ticketMessage.count()).toBe(0);
    expect((await post(a, ticket.id, { body: "with a valid token" })).status).toBe(201);
  });

  it("refuses closed tickets", async () => {
    const ticket = await ticketFor();
    await prisma.ticket.update({ where: { id: ticket.id }, data: { status: "CLOSED" } });
    const a = await login(app, config, authorA!.email);
    const response = await post(a, ticket.id, { body: "too late" });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("CONFLICT");
    expect(await prisma.ticketMessage.count()).toBe(0);
  });
});

describe("input validation", () => {
  it("rejects empty, whitespace, missing, non-string and oversized bodies", async () => {
    const ticket = await ticketFor();
    const a = await login(app, config, authorA!.email);
    for (const body of [{}, { body: "" }, { body: "   \n\t " }, { body: null }, { body: 12 }, { body: ["a"] }, { body: "x".repeat(10_001) }, []]) {
      const response = await post(a, ticket.id, body);
      expect(response.status, JSON.stringify(body).slice(0, 40)).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    }
    const malformed = await a.agent.post(`/api/v1/author/tickets/${ticket.id}/messages`).set("Origin", WEB_ORIGIN).set("X-CSRF-Token", a.csrf).set("Content-Type", "application/json").send("{not json");
    expect(malformed.status).toBe(400);
    expect(await prisma.ticketMessage.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
    // The boundary itself is accepted.
    expect((await post(a, ticket.id, { body: "y".repeat(10_000) })).status).toBe(201);
  });
});

describe("consistency and failure", () => {
  it("treats a retried identical message as the same message, including concurrent retries", async () => {
    const ticket = await ticketFor();
    const a = await login(app, config, authorA!.email);
    const first = await post(a, ticket.id, { body: "Please look at this" });
    const burst = await Promise.all(Array.from({ length: 6 }, () => post(a, ticket.id, { body: "Please look at this" })));
    expect(burst.every((r) => r.status === 201 && r.body.message.id === first.body.message.id)).toBe(true);
    expect(await prisma.ticketMessage.count()).toBe(1);
    expect(await prisma.auditLog.count()).toBe(1);
    expect((await post(a, ticket.id, { body: "A different message" })).body.message.id).not.toBe(first.body.message.id);
  });

  it("is atomic: a failing audit write leaves no message and does not touch the ticket", async () => {
    const ticket = await ticketFor();
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION "test_fail_audit_fn"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END; $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER "test_fail_audit" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "test_fail_audit_fn"()`);
    const a = await login(app, config, authorA!.email);
    const response = await post(a, ticket.id, { body: "This must roll back" });
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(response.body)).not.toMatch(/audit unavailable/);
    expect(await prisma.ticketMessage.count()).toBe(0);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).updatedAt.getTime()).toBe(ticket.updatedAt.getTime());
    // And no event was announced for the failed write (checked indirectly: nothing is queued for the next success).
    await prisma.$executeRawUnsafe(`DROP TRIGGER "test_fail_audit" ON "AuditLog"`);
    expect((await post(a, ticket.id, { body: "This one commits" })).status).toBe(201);
    expect(await prisma.ticketMessage.count()).toBe(1);
  });

  it("throttles per author without affecting others", async () => {
    const limited = createTestApp(prisma, { AUTHOR_REPLY_LIMIT_PER_HOUR: "2" });
    const mine = await ticketFor(authorA!);
    const theirs = await ticketFor(authorB!);
    const a = await login(limited.app, limited.config, authorA!.email);
    const b = await login(limited.app, limited.config, authorB!.email);
    expect((await post(a, mine.id, { body: "one" })).status).toBe(201);
    expect((await post(a, mine.id, { body: "two" })).status).toBe(201);
    const third = await post(a, mine.id, { body: "three" });
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe("RATE_LIMITED");
    expect(Number(third.headers["retry-after"])).toBeGreaterThan(0);
    expect((await post(b, theirs.id, { body: "other author" })).status).toBe(201);
    expect(await prisma.ticketMessage.count({ where: { ticketId: mine.id } })).toBe(2);
  });
});

describe("live events", () => {
  async function connect(email: string) {
    const client = await login(app, config, email);
    const cookie = `${config.sessionCookieName}=${cookieValue(client.response.headers["set-cookie"], config.sessionCookieName)}`;
    const stream = await openStream(server.port, cookie);
    open.push(stream);
    return { client, stream };
  }

  it("announces ticket.reply.created to admins and the owning author only, with a minimal payload", async () => {
    const ticket = await ticketFor(authorA!);
    const owner = await connect(authorA!.email);
    const other = await connect(authorB!.email);
    const admin = await connect(ADMIN_EMAIL);
    const response = await post(owner.client, ticket.id, { body: "SECRET-AUTHOR-MESSAGE-5521" });
    expect(response.status).toBe(201);

    const adminEvents = await admin.stream.waitFor((e) => e.some((x) => x.event === "ticket.reply.created"));
    await owner.stream.waitFor((e) => e.some((x) => x.event === "ticket.reply.created"));
    expect(await other.stream.quiet(250)).toEqual([]);
    const event = adminEvents.find((e) => e.event === "ticket.reply.created")!;
    expect(Object.keys(event.data).sort()).toEqual(["occurredAt", "ticketId", "version"]);
    expect(event.data.ticketId).toBe(ticket.id);
    const polled = await owner.client.agent.get(`/api/v1/author/tickets/${ticket.id}`);
    expect(event.data.version).toBe(polled.body.ticket.updatedAt);
    for (const stream of [admin.stream, owner.stream, other.stream]) expect(stream.raw()).not.toMatch(/5521|SECRET/);
  });

  it("announces nothing for rejected or duplicate submissions", async () => {
    const ticket = await ticketFor(authorA!);
    const admin = await connect(ADMIN_EMAIL);
    const b = await login(app, config, authorB!.email);
    const a = await login(app, config, authorA!.email);
    await post(b, ticket.id, { body: "foreign" });
    await post(a, ticket.id, { body: "" });
    expect(await admin.stream.quiet(250)).toEqual([]);
    await post(a, ticket.id, { body: "real" });
    await admin.stream.waitFor((e) => e.length >= 1);
    await post(a, ticket.id, { body: "real" }); // retry
    expect((await admin.stream.quiet(250)).length).toBe(0);
    expect(admin.stream.events).toHaveLength(1);
  });
});
