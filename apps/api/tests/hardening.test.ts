import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Router } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { PrismaClient } from "@bookleaf/db";
import { importSeedData } from "@bookleaf/db/seed";
import { AiAttemptService } from "../src/ai/attempts.js";
import { assertUtf8Database, DatabaseEncodingError } from "../src/db-check.js";
import { loadConfig } from "../src/config.js";
import { LocalDiskStorage } from "../src/attachments/storage.js";
import { MAX_SESSIONS_PER_USER } from "../src/auth/sessions.js";
import { TicketEventHub } from "../src/events/hub.js";
import { createAdminRouter } from "../src/routes/admin.js";
import { createAuthorRouter } from "../src/routes/author.js";
import { createEventsRouter } from "../src/routes/events.js";
import { silentLogger } from "../src/http/logger.js";
import { ADMIN_EMAIL, TEST_PASSWORD, WEB_ORIGIN, cookieValue, createTestApp, loadSyntheticDataset, login, makeTicket, mutate, profileFor, resetDatabase, seedSynthetic, testConfig } from "./helpers.js";
import { captureLogger, completedRow, failedRow, fakeEngine, gate, openStream, startServer } from "./m3helpers.js";

const prisma = new PrismaClient();
const [authorA, authorB] = loadSyntheticDataset();
const attachDir = mkdtempSync(join(tmpdir(), "bookleaf-hard-"));

beforeAll(() => rmSync(attachDir, { recursive: true, force: true }));
beforeEach(async () => {
  await resetDatabase(prisma);
  await seedSynthetic(prisma);
});
afterAll(async () => {
  rmSync(attachDir, { recursive: true, force: true });
  await prisma.$disconnect();
});

interface RouteInfo { method: string; path: string }
function routesOf(router: Router): RouteInfo[] {
  const stack = (router as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> }).stack;
  return stack.flatMap((layer) => (layer.route ? Object.keys(layer.route.methods).map((method) => ({ method: method.toUpperCase(), path: layer.route!.path })) : []));
}
const concrete = (path: string) => path.replace(/:[A-Za-z]+/g, "x");

const config = testConfig({ ATTACHMENT_DIR: attachDir });
const deps = { prisma, config, storage: new LocalDiskStorage(attachDir), logger: silentLogger, events: new TicketEventHub() };
const adminRoutes = routesOf(createAdminRouter({ prisma, storage: deps.storage, events: deps.events, ai: new AiAttemptService({ prisma, engine: fakeEngine() }) }));
const authorRoutes = routesOf(createAuthorRouter(deps));
const eventRoutes = routesOf(createEventsRouter({ prisma, hub: deps.events }));

describe("authorisation is enforced on every route (introspected, so new routes are covered automatically)", () => {
  it("discovers the expected route surface", () => {
    expect(adminRoutes).toHaveLength(10);
    expect(authorRoutes).toHaveLength(9);
    expect(eventRoutes).toEqual([{ method: "GET", path: "/tickets" }]);
  });

  it("every admin route rejects anonymous callers with 401 and authors with 403", async () => {
    const { app, config: appConfig } = createTestApp(prisma);
    const author = await login(app, appConfig, authorA!.email);
    for (const route of adminRoutes) {
      const url = `/api/v1/admin${concrete(route.path)}`;
      const send = (req: request.Test) => req.send({});
      const anonymous = await send(request(app)[route.method.toLowerCase() as "get"](url).set("Origin", WEB_ORIGIN));
      expect(anonymous.status, `anonymous ${route.method} ${url}`).toBe(401);
      const asAuthor = route.method === "GET"
        ? await author.agent.get(url)
        : await send(author.agent[route.method.toLowerCase() as "post"](url).set("Origin", WEB_ORIGIN).set("X-CSRF-Token", author.csrf));
      expect(asAuthor.status, `author ${route.method} ${url}`).toBe(403);
      expect(JSON.stringify(asAuthor.body)).not.toMatch(/passwordHash|stack/);
    }
  });

  it("every author route rejects anonymous callers with 401 and admins with 403", async () => {
    const { app, config: appConfig } = createTestApp(prisma);
    const admin = await login(app, appConfig, ADMIN_EMAIL);
    for (const route of authorRoutes) {
      const url = `/api/v1/author${concrete(route.path)}`;
      const anonymous = await request(app)[route.method.toLowerCase() as "get"](url).set("Origin", WEB_ORIGIN).send({});
      expect(anonymous.status, `anonymous ${route.method} ${url}`).toBe(401);
      const asAdmin = route.method === "GET"
        ? await admin.agent.get(url)
        : await admin.agent[route.method.toLowerCase() as "post"](url).set("Origin", WEB_ORIGIN).set("X-CSRF-Token", admin.csrf).send({});
      expect(asAdmin.status, `admin ${route.method} ${url}`).toBe(403);
    }
  });

  it("every state-changing route (admin and author) requires the CSRF token", async () => {
    const { app, config: appConfig } = createTestApp(prisma);
    const admin = await login(app, appConfig, ADMIN_EMAIL);
    const author = await login(app, appConfig, authorA!.email);
    const mutating = [
      ...adminRoutes.filter((r) => r.method !== "GET").map((r) => ({ ...r, url: `/api/v1/admin${concrete(r.path)}`, client: admin })),
      ...authorRoutes.filter((r) => r.method !== "GET").map((r) => ({ ...r, url: `/api/v1/author${concrete(r.path)}`, client: author })),
      { method: "POST", path: "/auth/logout", url: "/api/v1/auth/logout", client: admin }
    ];
    expect(mutating).toHaveLength(9);
    for (const route of mutating) {
      const method = route.method.toLowerCase() as "post";
      const missing = await route.client.agent[method](route.url).set("Origin", WEB_ORIGIN).send({});
      expect(missing.status, `no token ${route.method} ${route.url}`).toBe(403);
      const wrong = await route.client.agent[method](route.url).set("Origin", WEB_ORIGIN).set("X-CSRF-Token", "forged").send({});
      expect(wrong.status, `forged token ${route.method} ${route.url}`).toBe(403);
      const foreignOrigin = await route.client.agent[method](route.url).set("Origin", "https://evil.example.com").set("X-CSRF-Token", route.client.csrf).send({});
      expect(foreignOrigin.status, `foreign origin ${route.method} ${route.url}`).toBe(403);
    }
    expect((await admin.agent.get("/api/v1/auth/me")).status).toBe(200); // none of the rejected logouts took effect
  });

  it("the event stream needs a session", async () => {
    const { app } = createTestApp(prisma);
    expect((await request(app).get("/api/v1/events/tickets")).status).toBe(401);
  });
});

describe("every admin mutation is audited", () => {
  it("covers exactly the known mutating routes (a new one fails this test until it is audited)", () => {
    const mutating = adminRoutes.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.path}`).sort();
    expect(mutating).toEqual([
      "PATCH /tickets/:ticketId", "POST /tickets/:ticketId/ai-analysis", "POST /tickets/:ticketId/internal-notes", "POST /tickets/:ticketId/replies", "PUT /tickets/:ticketId/assignment"
    ]);
  });

  it("writes an audit row, with the acting admin, for each of them", async () => {
    const { app, config: appConfig } = createTestApp(prisma, {}, { ai: new AiAttemptService({ prisma, engine: fakeEngine() }) });
    const admin = await login(app, appConfig, ADMIN_EMAIL);
    const me = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    const ticket = await makeTicket(prisma, (await profileFor(prisma, authorA!.author_id)).id);
    const base = `/api/v1/admin/tickets/${ticket.id}`;
    const calls: Array<[string, () => Promise<{ status: number }>]> = [
      ["ticket.status.updated", () => mutate(admin, "patch", base).send({ status: "IN_PROGRESS" })],
      ["ticket.priority.updated", () => mutate(admin, "patch", base).send({ priority: "HIGH" })],
      ["ticket.category.updated", () => mutate(admin, "patch", base).send({ category: "ISBN_METADATA" })],
      ["ticket.reply.created", () => mutate(admin, "post", `${base}/replies`).send({ body: "audit me" })],
      ["ticket.internal_note.created", () => mutate(admin, "post", `${base}/internal-notes`).send({ body: "audit me too" })],
      ["ticket.assignment.updated", () => mutate(admin, "put", `${base}/assignment`).send({ assigneeId: me.id })],
      ["ticket.ai_analysis.requested", () => mutate(admin, "post", `${base}/ai-analysis`).send({})]
    ];
    for (const [action, call] of calls) {
      const before = await prisma.auditLog.count({ where: { action } });
      expect([200, 201, 202], action).toContain((await call()).status);
      expect(await prisma.auditLog.count({ where: { action } }), action).toBe(before + 1);
    }
    const rows = await prisma.auditLog.findMany();
    expect(rows.every((r) => r.actorId === me.id && r.entityType === "Ticket" && r.entityId === ticket.id && r.requestId)).toBe(true);
  });

  it("does not audit requests that changed nothing or failed", async () => {
    const { app, config: appConfig } = createTestApp(prisma);
    const admin = await login(app, appConfig, ADMIN_EMAIL);
    const ticket = await makeTicket(prisma, (await profileFor(prisma, authorA!.author_id)).id, { priority: "LOW" });
    await mutate(admin, "patch", `/api/v1/admin/tickets/${ticket.id}`).send({ priority: "LOW" });
    await mutate(admin, "patch", `/api/v1/admin/tickets/${ticket.id}`).send({ status: "BOGUS" });
    await mutate(admin, "post", `/api/v1/admin/tickets/${ticket.id}/replies`).send({ body: "" });
    await mutate(admin, "put", `/api/v1/admin/tickets/${ticket.id}/assignment`).send({ assigneeId: "someone-else" });
    expect(await prisma.auditLog.count()).toBe(0);
  });
});

describe("database guards (defence in depth)", () => {
  const setup = async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    const profile = await profileFor(prisma, authorA!.author_id);
    const authorUser = await prisma.user.findUniqueOrThrow({ where: { id: profile.userId } });
    const ticket = await makeTicket(prisma, profile.id);
    return { admin, authorUser, ticket };
  };

  it("only admins can be assignees, assigners or note authors", async () => {
    const { admin, authorUser, ticket } = await setup();
    await expect(prisma.ticket.update({ where: { id: ticket.id }, data: { assigneeId: authorUser.id } })).rejects.toThrow(/assignee must be an admin/);
    await expect(prisma.ticketAssignment.create({ data: { ticketId: ticket.id, assigneeId: authorUser.id, assignedById: admin.id } })).rejects.toThrow(/assignee must be an admin/);
    await expect(prisma.ticketAssignment.create({ data: { ticketId: ticket.id, assigneeId: admin.id, assignedById: authorUser.id } })).rejects.toThrow(/only be made by an admin/);
    await expect(prisma.internalNote.create({ data: { ticketId: ticket.id, authorId: authorUser.id, body: "x" } })).rejects.toThrow(/written by an admin/);
    await expect(prisma.ticketMessage.create({ data: { ticketId: ticket.id, authorId: authorUser.id, body: "x", visibility: "ADMIN" } })).rejects.toThrow(/must be written by an admin/);
    await expect(prisma.ticketMessage.create({ data: { ticketId: ticket.id, authorId: authorUser.id, body: "fine", visibility: "AUTHOR" } })).resolves.toBeDefined();
    await expect(prisma.ticket.update({ where: { id: ticket.id }, data: { assigneeId: admin.id } })).resolves.toBeDefined();
  });

  it("internal notes are immutable and assignment history is append-only", async () => {
    const { admin, ticket } = await setup();
    const note = await prisma.internalNote.create({ data: { ticketId: ticket.id, authorId: admin.id, body: "original" } });
    await expect(prisma.internalNote.update({ where: { id: note.id }, data: { body: "edited" } })).rejects.toThrow(/immutable/);
    const assignment = await prisma.ticketAssignment.create({ data: { ticketId: ticket.id, assigneeId: admin.id, assignedById: admin.id } });
    await expect(prisma.ticketAssignment.update({ where: { id: assignment.id }, data: { assignedById: admin.id, createdAt: new Date(0) } })).rejects.toThrow(/append-only/);
    // Removing the user still works: the assignee reference is nulled and the row is otherwise untouched.
    const second = await prisma.user.create({ data: { email: "temp.admin@example.test", role: "ADMIN", passwordHash: admin.passwordHash } });
    const handed = await prisma.ticketAssignment.create({ data: { ticketId: ticket.id, assigneeId: second.id, assignedById: admin.id } });
    await prisma.ticket.update({ where: { id: ticket.id }, data: { assigneeId: second.id } });
    await prisma.user.delete({ where: { id: second.id } });
    expect(await prisma.ticketAssignment.findUniqueOrThrow({ where: { id: handed.id } })).toMatchObject({ assigneeId: null, assignedById: admin.id });
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).assigneeId).toBeNull();
  });
});

describe("sessions", () => {
  it("caps live sessions per user, revoking the oldest", async () => {
    const { app, config: appConfig } = createTestApp(prisma);
    const tokens: string[] = [];
    for (let i = 0; i < MAX_SESSIONS_PER_USER + 3; i += 1) {
      const response = await request(app).post("/api/v1/auth/login").set("Origin", WEB_ORIGIN).send({ email: authorA!.email, password: TEST_PASSWORD });
      expect(response.status).toBe(200);
      tokens.push(cookieValue(response.headers["set-cookie"], appConfig.sessionCookieName)!);
    }
    expect(await prisma.session.count({ where: { user: { email: authorA!.email } } })).toBe(MAX_SESSIONS_PER_USER);
    const status = async (token: string) => (await request(app).get("/api/v1/auth/me").set("Cookie", `${appConfig.sessionCookieName}=${token}`)).status;
    expect(await status(tokens[0]!)).toBe(401);
    expect(await status(tokens[2]!)).toBe(401);
    expect(await status(tokens[3]!)).toBe(200);
    expect(await status(tokens.at(-1)!)).toBe(200);
  });

  it("issues the CSRF cookie under the name the frontend reads (XSRF-TOKEN) as a script-readable cookie", async () => {
    expect(loadConfig({ DATABASE_URL: "x", SESSION_SECRET: "s".repeat(40), WEB_ORIGIN }).csrfCookieName).toBe("XSRF-TOKEN");
    const { app } = createTestApp(prisma);
    const response = await request(app).post("/api/v1/auth/login").set("Origin", WEB_ORIGIN).send({ email: authorA!.email, password: TEST_PASSWORD });
    const cookies = response.headers["set-cookie"] as unknown as string[];
    const csrf = cookies.find((c) => c.startsWith("XSRF-TOKEN="))!;
    expect(csrf).toBeDefined();
    expect(csrf).not.toMatch(/HttpOnly/i);
    expect(cookies.find((c) => c.startsWith("bookleaf_session="))).toMatch(/HttpOnly/i);
    // The exact regular expression used by the frontend client (apps/web/src/api/http.ts).
    const documentCookie = cookies.map((c) => c.split(";")[0]).join("; ");
    const match = documentCookie.match(/(?:^|;\s*)(?:XSRF-TOKEN|csrfToken|_csrf)=([^;]+)/);
    expect(match?.[1] && decodeURIComponent(match[1])).toBe(cookieValue(cookies, "XSRF-TOKEN"));
  });

  it("clears the throttle counter after a successful login but still blocks repeated failures", async () => {
    const { app } = createTestApp(prisma, { LOGIN_MAX_FAILURES: "3" });
    const attempt = (email: string, password: string) => request(app).post("/api/v1/auth/login").set("Origin", WEB_ORIGIN).send({ email, password });
    expect((await attempt(authorA!.email, "bad password 1")).status).toBe(401);
    expect((await attempt(authorA!.email, "bad password 2")).status).toBe(401);
    expect((await attempt(authorA!.email, TEST_PASSWORD)).status).toBe(200);
    expect((await attempt(authorA!.email, "bad password 3")).status).toBe(401);
    expect((await attempt(authorA!.email, "bad password 4")).status).toBe(401);
    expect((await attempt(authorA!.email, "bad password 5")).status).toBe(401);
    expect((await attempt(authorA!.email, TEST_PASSWORD)).status).toBe(429);
    expect((await attempt(authorB!.email, TEST_PASSWORD)).status).toBe(200); // other accounts are unaffected
  });
});

describe("log hygiene", () => {
  it("never writes credentials, cookies, bodies, query strings or personal data to the log", async () => {
    const log = captureLogger();
    const engine = fakeEngine(async () => { throw new Error("provider said: key sk-LOG-SECRET-KEY for jane.private@example.test"); });
    const ai = new AiAttemptService({ prisma, engine, logger: log.logger, refreshCooldownMs: 0 });
    const { app, config: appConfig } = createTestApp(prisma, { ATTACHMENT_DIR: attachDir, ATTACHMENT_MAX_PER_TICKET: "3" }, { ai, logger: log.logger });
    const author = await login(app, appConfig, authorA!.email);
    await request(app).post("/api/v1/auth/login").set("Origin", WEB_ORIGIN).send({ email: "nobody@example.test", password: "LOG-PASSWORD-PROBE-1" });
    await request(app).post("/api/v1/auth/login").set("Origin", WEB_ORIGIN).send({ email: "not-an-email", password: "LOG-PASSWORD-PROBE-2" });
    const created = await mutate(author, "post", "/api/v1/author/tickets").send({ bookId: null, subject: "LOG-SUBJECT-PROBE", description: "LOG-DESCRIPTION-PROBE with enough text" });
    await ai.idle();
    const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from("LOG-FILE-BODY-PROBE")]);
    await mutate(author, "post", `/api/v1/author/tickets/${created.body.ticket.id}/attachments?filename=LOG-FILENAME-PROBE.pdf`).set("Content-Type", "application/pdf").send(pdf);
    await author.agent.get("/api/v1/author/tickets?status=LOG-QUERY-PROBE");
    const admin = await login(app, appConfig, ADMIN_EMAIL);
    await mutate(admin, "post", `/api/v1/admin/tickets/${created.body.ticket.id}/replies`).send({ body: "LOG-REPLY-PROBE" });
    await mutate(admin, "post", `/api/v1/admin/tickets/${created.body.ticket.id}/internal-notes`).send({ body: "LOG-NOTE-PROBE" });
    // Force an unexpected 500 and an AI crash, which are the paths most likely to echo data.
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION "hyg_fail"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'db said: LOG-DB-SECRET jane.private@example.test'; END; $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER "hyg_fail_trigger" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "hyg_fail"()`);
    try {
      const failure = await mutate(admin, "post", `/api/v1/admin/tickets/${created.body.ticket.id}/replies`).send({ body: "LOG-REPLY-PROBE-2" });
      expect(failure.status).toBe(500);
      expect(JSON.stringify(failure.body)).not.toMatch(/LOG-DB-SECRET|jane\.private/);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "hyg_fail_trigger" ON "AuditLog"`);
    }

    const text = log.text();
    expect(log.lines.length).toBeGreaterThan(10);
    for (const secret of [
      "LOG-PASSWORD-PROBE", TEST_PASSWORD, "LOG-SUBJECT-PROBE", "LOG-DESCRIPTION-PROBE", "LOG-FILE-BODY-PROBE", "LOG-FILENAME-PROBE", "LOG-QUERY-PROBE",
      "LOG-REPLY-PROBE", "LOG-NOTE-PROBE", "LOG-DB-SECRET", "LOG-SECRET-KEY", "jane.private", authorA!.email, "nobody@example.test", "sk-", "cookie", "csrf-token"
    ]) expect(text.toLowerCase(), secret).not.toContain(secret.toLowerCase());
    expect(text).not.toMatch(/argon2|passwordHash|tokenHash/i);
    // Access-log entries carry method, path (without the query string), status and timing only.
    const access = log.lines.filter((l) => l.message === "request");
    expect(access.length).toBeGreaterThan(5);
    expect(access.every((l) => typeof l.path === "string" && !(l.path as string).includes("?"))).toBe(true);
  });
});

describe("reliability under load and failure", () => {
  it("never starves fresh failures behind tickets that already exhausted their retries", async () => {
    const engine = fakeEngine();
    const ai = new AiAttemptService({ prisma, engine, retryMinGapMs: 0, maxAutoRetries: 2 });
    const pa = (await profileFor(prisma, authorA!.author_id)).id;
    const old = new Date(Date.now() - 3_600_000);
    // 60 tickets whose latest attempt is a retryable failure but which already used all their retries.
    for (let i = 0; i < 60; i += 1) {
      const t = await makeTicket(prisma, pa);
      await prisma.aiAnalysis.createMany({ data: [0, 1, 2].map((n) => ({ ticketId: t.id, promptVersion: "v", status: "FAILED" as const, errorCode: "AI_TIMEOUT", createdAt: new Date(old.getTime() + n * 1000) })) });
    }
    const fresh = await makeTicket(prisma, pa);
    await prisma.aiAnalysis.create({ data: { ticketId: fresh.id, promptVersion: "v", status: "FAILED", errorCode: "AI_TIMEOUT", createdAt: new Date(Date.now() - 1000) } });
    const result = await ai.recover();
    await ai.idle();
    expect(result.retried).toBe(1);
    expect(await prisma.aiAnalysis.count({ where: { ticketId: fresh.id } })).toBe(2);
    expect(engine.calls).toHaveLength(1);
    expect((await ai.recover()).retried).toBe(0);
  });

  it("a late result from an abandoned attempt cannot overwrite a newer attempt", async () => {
    const release = gate();
    const engine = fakeEngine(async () => { await release.promise; return { row: completedRow({ rationale: "LATE" }), quality: "MODEL" }; }, 60_000);
    const log = captureLogger();
    const events = new TicketEventHub();
    const ai = new AiAttemptService({ prisma, engine, events, logger: log.logger, refreshCooldownMs: 0 });
    const { app, config: appConfig } = createTestApp(prisma, { TICKET_CREATE_LIMIT_PER_HOUR: "100" }, { ai, events });
    const author = await login(app, appConfig, authorA!.email);
    const created = await mutate(author, "post", "/api/v1/author/tickets").send({ bookId: null, subject: "Late result", description: "Description long enough." });
    const ticketId = created.body.ticket.id as string;
    const [first] = await prisma.aiAnalysis.findMany({ where: { ticketId } });
    // Operator closes the first attempt and a newer, completed attempt exists before the slow run finishes.
    await prisma.aiAnalysis.update({ where: { id: first!.id }, data: { status: "FAILED", errorCode: "AI_ATTEMPT_ABANDONED" } });
    const newer = await prisma.aiAnalysis.create({ data: { ticketId, promptVersion: "v", status: "COMPLETED", category: "GENERAL_INQUIRY", priority: "LOW", confidence: 0.5, rationale: "NEWER", draftResponse: "newer draft", citations: [], createdAt: new Date(Date.now() + 5000) } });
    release.release();
    await ai.idle();
    expect(await prisma.aiAnalysis.findUniqueOrThrow({ where: { id: first!.id } })).toMatchObject({ status: "FAILED", errorCode: "AI_ATTEMPT_ABANDONED", rationale: null });
    expect(await prisma.aiAnalysis.findUniqueOrThrow({ where: { id: newer.id } })).toMatchObject({ status: "COMPLETED", rationale: "NEWER" });
    const admin = await login(app, appConfig, ADMIN_EMAIL);
    const latest = await admin.agent.get(`/api/v1/admin/tickets/${ticketId}/ai-analysis`);
    expect(latest.body.analysis).toMatchObject({ id: newer.id, status: "COMPLETED" });
    expect(JSON.stringify(latest.body)).not.toContain("LATE");
  });

  it("keeps working when the AI is down: creation, replies and manual classification are unaffected", async () => {
    const ai = new AiAttemptService({ prisma, engine: fakeEngine(async () => ({ row: failedRow("AI_PROVIDER_ERROR"), quality: "FULL_FALLBACK", retry: "later" })), retryMinGapMs: 60_000 });
    const { app, config: appConfig } = createTestApp(prisma, { TICKET_CREATE_LIMIT_PER_HOUR: "100" }, { ai });
    const author = await login(app, appConfig, authorA!.email);
    const created = await mutate(author, "post", "/api/v1/author/tickets").send({ bookId: null, subject: "AI is down", description: "Description long enough." });
    expect(created.status).toBe(201);
    await ai.idle();
    const admin = await login(app, appConfig, ADMIN_EMAIL);
    const base = `/api/v1/admin/tickets/${created.body.ticket.id}`;
    expect((await mutate(admin, "patch", base).send({ status: "IN_PROGRESS", category: "ROYALTY_PAYMENTS", priority: "HIGH" })).status).toBe(200);
    expect((await mutate(admin, "post", `${base}/replies`).send({ body: "Handled manually." })).status).toBe(201);
    const detail = await author.agent.get(`/api/v1/author/tickets/${created.body.ticket.id}`);
    expect(detail.body.messages.map((m: { body: string }) => m.body)).toEqual(["Handled manually."]);
    expect(detail.body.ticket).toMatchObject({ status: "IN_PROGRESS", category: "ROYALTY_PAYMENTS", priority: "HIGH" });
  });

  it("tells a reconnecting client when a replay was truncated, and still sends the newest changes", async () => {
    const events = new TicketEventHub();
    const { app, config: appConfig } = createTestApp(prisma, {}, { events, sseCatchUpLimit: 2 });
    const server = await startServer(app);
    try {
      const pa = (await profileFor(prisma, authorA!.author_id)).id;
      const tickets = await Promise.all([makeTicket(prisma, pa), makeTicket(prisma, pa), makeTicket(prisma, pa)]);
      expect(tickets).toHaveLength(3);
      const admin = await login(app, appConfig, ADMIN_EMAIL);
      const cookie = `${appConfig.sessionCookieName}=${cookieValue(admin.response.headers["set-cookie"], appConfig.sessionCookieName)}`;
      const stream = await openStream(server.port, cookie, { "Last-Event-ID": `${Date.now() - 60_000}-1` });
      await stream.waitFor((e) => e.length >= 2);
      expect(stream.raw()).toContain(": catch-up truncated");
      expect(stream.events).toHaveLength(2);
      stream.close();
    } finally {
      events.closeAll();
      await server.close();
    }
  });
});

describe("unicode and database encoding", () => {
  const TEXT = "रॉयल्टी ₹2,500 — café naïve 日本語 😀";

  it("the test database is UTF8, and the startup guard accepts it", async () => {
    const [row] = await prisma.$queryRaw<Array<{ server_encoding: string }>>`SHOW server_encoding`;
    expect(row?.server_encoding).toBe("UTF8");
    await expect(assertUtf8Database(prisma)).resolves.toBeUndefined();
  });

  it("the startup guard refuses a non-UTF8 database with a clear, value-free error", async () => {
    const fake = { $queryRaw: async () => [{ server_encoding: "WIN1252" }] } as unknown as PrismaClient;
    await expect(assertUtf8Database(fake)).rejects.toThrow(DatabaseEncodingError);
    await expect(assertUtf8Database(fake)).rejects.toThrow(/UTF8/);
  });

  it("stores and returns non-ASCII text exactly across tickets, replies, notes, AI drafts and attachments", async () => {
    const engine = fakeEngine(async () => ({ row: completedRow({ draftResponse: `Dear Author, ${TEXT}`, rationale: TEXT }), quality: "MODEL" }));
    const ai = new AiAttemptService({ prisma, engine });
    const { app, config: appConfig } = createTestApp(prisma, { ATTACHMENT_DIR: attachDir, TICKET_CREATE_LIMIT_PER_HOUR: "100" }, { ai });
    const author = await login(app, appConfig, authorA!.email);
    const admin = await login(app, appConfig, ADMIN_EMAIL);

    const created = await mutate(author, "post", "/api/v1/author/tickets").send({ bookId: null, subject: `Subject ${TEXT}`, description: `Description ${TEXT}` });
    expect(created.status).toBe(201);
    const id = created.body.ticket.id as string;
    await ai.idle();
    expect(created.body.ticket).toMatchObject({ subject: `Subject ${TEXT}`, description: `Description ${TEXT}` });

    await mutate(admin, "post", `/api/v1/admin/tickets/${id}/replies`).send({ body: `Reply ${TEXT}` });
    await mutate(admin, "post", `/api/v1/admin/tickets/${id}/internal-notes`).send({ body: `Note ${TEXT}` });
    const upload = await mutate(author, "post", `/api/v1/author/tickets/${id}/attachments?filename=${encodeURIComponent("रिपोर्ट ₹.txt")}`).set("Content-Type", "text/plain").send(Buffer.from(TEXT, "utf8"));
    expect(upload.status).toBe(201);
    expect(upload.body.attachment.fileName).toBe("रिपोर्ट ₹.txt");

    const detail = (await author.agent.get(`/api/v1/author/tickets/${id}`)).body;
    expect(detail.messages[0].body).toBe(`Reply ${TEXT}`);
    const adminDetail = (await admin.agent.get(`/api/v1/admin/tickets/${id}`)).body;
    expect(adminDetail.internalNotes[0].body).toBe(`Note ${TEXT}`);
    expect(adminDetail.aiAnalysis.analysis).toMatchObject({ draftResponse: `Dear Author, ${TEXT}`, rationale: TEXT });
    const download = await author.agent.get(`/api/v1/author/tickets/${id}/attachments/${upload.body.attachment.id}`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect((download.body as Buffer).toString("utf8")).toBe(TEXT);
    expect(download.headers["content-disposition"]).toContain("filename*=UTF-8''%E0%A4%B0");
  });

  it("imports authors and books with non-ASCII names unchanged", async () => {
    await resetDatabase(prisma);
    const dataset = JSON.parse(JSON.stringify(loadSyntheticDataset()));
    dataset[0].name = "प्रिया शर्मा";
    dataset[0].city = "नई दिल्ली";
    dataset[0].books[0].title = "मेरी कहानी ₹";
    await importSeedData(prisma, dataset, { credentials: { authorPassword: TEST_PASSWORD }, hash: async () => "$argon2id$placeholder" });
    const profile = await prisma.authorProfile.findUniqueOrThrow({ where: { externalAuthorId: dataset[0].author_id } });
    expect(profile).toMatchObject({ name: "प्रिया शर्मा", city: "नई दिल्ली" });
    expect((await prisma.book.findUniqueOrThrow({ where: { externalBookId: dataset[0].books[0].book_id } })).title).toBe("मेरी कहानी ₹");
  });
});
