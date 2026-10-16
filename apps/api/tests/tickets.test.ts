import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { apiErrorSchema, ticketDetailResponseSchema, ticketListResponseSchema, ticketResponseSchema } from "@bookleaf/contracts";
import { PrismaClient } from "@bookleaf/db";
import { ADMIN_EMAIL, WEB_ORIGIN, createTestApp, loadSyntheticDataset, login, makeTicket, mutate, profileFor, resetDatabase, seedSynthetic } from "./helpers.js";

const prisma = new PrismaClient();
const dataset = loadSyntheticDataset();
const [authorA, authorB] = dataset;
const hook = vi.fn();
const { app, config } = createTestApp(prisma, { TICKET_CREATE_LIMIT_PER_HOUR: "1000" }, { hooks: { onTicketCreated: hook } });

beforeEach(async () => {
  hook.mockReset();
  await resetDatabase(prisma);
  await seedSynthetic(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

const bookOf = async (externalAuthorId: string) => prisma.book.findFirstOrThrow({ where: { author: { externalAuthorId } }, orderBy: { externalBookId: "asc" } });
const valid = { bookId: null, subject: "Royalty not received", description: "I have not received my royalty for last quarter." };

describe("POST /author/tickets", () => {
  it("requires authentication, the AUTHOR role and CSRF", async () => {
    expect((await request(app).post("/api/v1/author/tickets").set("Origin", WEB_ORIGIN).send(valid)).status).toBe(401);
    const admin = await login(app, config, ADMIN_EMAIL);
    expect((await mutate(admin, "post", "/api/v1/author/tickets").send(valid)).status).toBe(403);
    const a = await login(app, config, authorA!.email);
    expect((await a.agent.post("/api/v1/author/tickets").set("Origin", WEB_ORIGIN).send(valid)).status).toBe(403); // no CSRF token
    expect((await a.agent.post("/api/v1/author/tickets").set("Origin", "https://evil.example.com").set("X-CSRF-Token", a.csrf).send(valid)).status).toBe(403);
    expect(await prisma.ticket.count()).toBe(0);
  });

  it("creates a general ticket as OPEN and unclassified, ignoring fields the author must not set", async () => {
    const a = await login(app, config, authorA!.email);
    const profile = await profileFor(prisma, authorA!.author_id);
    const other = await profileFor(prisma, authorB!.author_id);
    const response = await mutate(a, "post", "/api/v1/author/tickets").send({
      ...valid, status: "CLOSED", priority: "CRITICAL", category: "ROYALTY_PAYMENTS", assigneeId: "x", authorId: other.id
    });
    expect(response.status).toBe(201);
    const { ticket } = ticketResponseSchema.parse(response.body);
    expect(ticket).toMatchObject({ authorId: profile.id, bookId: null, status: "OPEN", category: null, priority: null, assigneeId: null, subject: valid.subject });
    expect(await prisma.ticket.count({ where: { authorId: other.id } })).toBe(0);
  });

  it("creates a book-specific ticket for the author's own book", async () => {
    const a = await login(app, config, authorA!.email);
    const book = await bookOf(authorA!.author_id);
    const response = await mutate(a, "post", "/api/v1/author/tickets").send({ ...valid, bookId: book.id });
    expect(response.status).toBe(201);
    expect(response.body.ticket.bookId).toBe(book.id);
  });

  it("refuses to link another author's book, indistinguishably from a missing book, and stores nothing", async () => {
    const a = await login(app, config, authorA!.email);
    const foreign = await bookOf(authorB!.author_id);
    const foreignRes = await mutate(a, "post", "/api/v1/author/tickets").send({ ...valid, bookId: foreign.id });
    const missingRes = await mutate(a, "post", "/api/v1/author/tickets").send({ ...valid, bookId: "does-not-exist" });
    expect(foreignRes.status).toBe(404);
    expect(missingRes.status).toBe(404);
    expect(foreignRes.body.error.message).toBe(missingRes.body.error.message);
    expect(await prisma.ticket.count()).toBe(0);
  });

  it("is backed by a database rule: a mismatched book/author pair cannot be written even directly", async () => {
    const profileA = await profileFor(prisma, authorA!.author_id);
    const foreign = await bookOf(authorB!.author_id);
    await expect(prisma.ticket.create({ data: { authorId: profileA.id, bookId: foreign.id, subject: "Subject", description: "Description text" } })).rejects.toThrow(/belong to the ticket author/);
  });

  it("validates every field with the shared schema", async () => {
    const a = await login(app, config, authorA!.email);
    const bad: unknown[] = [
      {}, { ...valid, subject: "ab" }, { ...valid, subject: "x".repeat(201) }, { ...valid, description: "short" }, { ...valid, description: "y".repeat(10_001) },
      { subject: valid.subject, description: valid.description }, { ...valid, bookId: "" }, { ...valid, bookId: 5 }, { ...valid, subject: "   " }
    ];
    for (const body of bad) {
      const response = await mutate(a, "post", "/api/v1/author/tickets").send(body as object);
      expect(response.status, JSON.stringify(body).slice(0, 60)).toBe(400);
      expect(apiErrorSchema.parse(response.body).error.code).toBe("VALIDATION_ERROR");
    }
    expect(await prisma.ticket.count()).toBe(0);
  });

  it("persists the ticket even when the AI hook fails, and calls the hook after commit", async () => {
    hook.mockRejectedValueOnce(new Error("AI provider unavailable with secret details"));
    const a = await login(app, config, authorA!.email);
    const response = await mutate(a, "post", "/api/v1/author/tickets").send(valid);
    expect(response.status).toBe(201);
    expect(JSON.stringify(response.body)).not.toMatch(/AI provider|secret/);
    expect(await prisma.ticket.findUnique({ where: { id: response.body.ticket.id } })).not.toBeNull();
    await vi.waitFor(() => expect(hook).toHaveBeenCalledWith({ id: response.body.ticket.id, authorId: response.body.ticket.authorId }));
  });

  it("throttles ticket creation per user", async () => {
    const limited = createTestApp(prisma, { TICKET_CREATE_LIMIT_PER_HOUR: "2" });
    const a = await login(limited.app, limited.config, authorA!.email);
    expect((await mutate(a, "post", "/api/v1/author/tickets").send(valid)).status).toBe(201);
    expect((await mutate(a, "post", "/api/v1/author/tickets").send(valid)).status).toBe(201);
    const third = await mutate(a, "post", "/api/v1/author/tickets").send(valid);
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe("RATE_LIMITED");
    expect(Number(third.headers["retry-after"])).toBeGreaterThan(0);
  });
});

describe("GET /author/tickets", () => {
  async function setup() {
    const [pa, pb] = [await profileFor(prisma, authorA!.author_id), await profileFor(prisma, authorB!.author_id)];
    const base = Date.UTC(2026, 0, 10);
    const mine = [
      await makeTicket(prisma, pa.id, { subject: "A open", status: "OPEN", priority: "HIGH", category: "ROYALTY_PAYMENTS", createdAt: new Date(base) }),
      await makeTicket(prisma, pa.id, { subject: "A resolved", status: "RESOLVED", priority: "LOW", category: "GENERAL_INQUIRY", createdAt: new Date(base + 86_400_000 * 5) }),
      await makeTicket(prisma, pa.id, { subject: "A progress", status: "IN_PROGRESS", createdAt: new Date(base + 86_400_000 * 10 + 3_600_000) })
    ];
    const theirs = await makeTicket(prisma, pb.id, { subject: "B secret ticket", status: "OPEN", priority: "HIGH", category: "ROYALTY_PAYMENTS", createdAt: new Date(base) });
    return { pa, pb, mine, theirs };
  }

  it("lists only the caller's tickets, newest first, as summaries without descriptions", async () => {
    const { mine, theirs } = await setup();
    const a = await login(app, config, authorA!.email);
    const response = await a.agent.get("/api/v1/author/tickets");
    expect(response.status).toBe(200);
    const body = ticketListResponseSchema.parse(response.body);
    expect(body).toMatchObject({ page: 1, pageSize: 25, total: 3 });
    expect(body.items.map((t) => t.subject)).toEqual(["A progress", "A resolved", "A open"]);
    expect(body.items.map((t) => t.id)).not.toContain(theirs.id);
    expect(body.items.every((t) => t.authorId === mine[0]!.authorId)).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain("description");
    const b = await login(app, config, authorB!.email);
    expect((await b.agent.get("/api/v1/author/tickets")).body.items.map((t: { subject: string }) => t.subject)).toEqual(["B secret ticket"]);
  });

  it("applies status, category, priority and date filters inside the author's scope", async () => {
    await setup();
    const a = await login(app, config, authorA!.email);
    const subjects = async (query: string) => (await a.agent.get(`/api/v1/author/tickets?${query}`)).body.items.map((t: { subject: string }) => t.subject);
    expect(await subjects("status=OPEN")).toEqual(["A open"]);
    expect(await subjects("category=GENERAL_INQUIRY")).toEqual(["A resolved"]);
    expect(await subjects("priority=HIGH")).toEqual(["A open"]); // B's HIGH ticket must not appear
    expect(await subjects("status=OPEN&priority=LOW")).toEqual([]);
    expect(await subjects("from=2026-01-15&to=2026-01-15")).toEqual(["A resolved"]);
    expect(await subjects("to=2026-01-20")).toEqual(["A progress", "A resolved", "A open"]); // date-only `to` includes that whole day
    expect(await subjects("to=2026-01-19")).toEqual(["A resolved", "A open"]);
    expect(await subjects("from=2026-01-20T00:00:00Z")).toEqual(["A progress"]);
  });

  it("cannot be redirected to another tenant through filters", async () => {
    const { pb } = await setup();
    const a = await login(app, config, authorA!.email);
    for (const query of [`authorId=${pb.id}`, `author=${pb.id}`, `authorProfileId=${pb.id}`, `userId=x`]) {
      expect((await a.agent.get(`/api/v1/author/tickets?${query}`)).status, query).toBe(400);
    }
    const all = await a.agent.get("/api/v1/author/tickets?pageSize=100&status=OPEN&priority=HIGH&category=ROYALTY_PAYMENTS");
    expect(all.body.total).toBe(1);
  });

  it("rejects invalid filter values and ranges", async () => {
    const a = await login(app, config, authorA!.email);
    for (const query of ["status=DONE", "status=open", "priority=URGENT", "category=OTHER", "from=yesterday", "to=nope", "from=2026-02-01&to=2026-01-01", "page=0", "pageSize=101", "status=OPEN&status=CLOSED"]) {
      const response = await a.agent.get(`/api/v1/author/tickets?${query}`);
      expect(response.status, query).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("paginates with the common envelope", async () => {
    await setup();
    const a = await login(app, config, authorA!.email);
    const p2 = await a.agent.get("/api/v1/author/tickets?page=2&pageSize=2");
    expect(p2.body).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(p2.body.items).toHaveLength(1);
    expect((await a.agent.get("/api/v1/author/tickets?page=5")).body).toEqual({ items: [], page: 5, pageSize: 25, total: 3 });
  });

  it("requires authentication", async () => {
    expect((await request(app).get("/api/v1/author/tickets")).status).toBe(401);
  });
});

describe("GET /author/tickets/:id", () => {
  it("returns own ticket detail, 404 for another author's and for missing tickets alike", async () => {
    const [pa, pb] = [await profileFor(prisma, authorA!.author_id), await profileFor(prisma, authorB!.author_id)];
    const mine = await makeTicket(prisma, pa.id);
    const theirs = await makeTicket(prisma, pb.id, { subject: "Private to B" });
    const a = await login(app, config, authorA!.email);
    const ok = await a.agent.get(`/api/v1/author/tickets/${mine.id}`);
    expect(ok.status).toBe(200);
    expect(ticketDetailResponseSchema.parse(ok.body).ticket.id).toBe(mine.id);
    const foreign = await a.agent.get(`/api/v1/author/tickets/${theirs.id}`);
    const missing = await a.agent.get("/api/v1/author/tickets/nope");
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body).toEqual({ error: { ...missing.body.error, requestId: foreign.body.error.requestId } });
    expect(JSON.stringify(foreign.body)).not.toContain("Private to B");
  });

  it("shows only author-visible messages and never internal notes or admin-only content", async () => {
    const pa = await profileFor(prisma, authorA!.author_id);
    const ticket = await makeTicket(prisma, pa.id);
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    const author = await prisma.user.findUniqueOrThrow({ where: { id: pa.userId } });
    await prisma.ticketMessage.createMany({ data: [
      { ticketId: ticket.id, authorId: admin.id, body: "Visible reply to author", visibility: "AUTHOR", createdAt: new Date(Date.now() - 2000) },
      { ticketId: ticket.id, authorId: admin.id, body: "ADMIN-ONLY-MESSAGE-XYZ", visibility: "ADMIN", createdAt: new Date(Date.now() - 1000) },
      { ticketId: ticket.id, authorId: author.id, body: "Author follow-up", visibility: "AUTHOR" }
    ] });
    await prisma.internalNote.create({ data: { ticketId: ticket.id, authorId: admin.id, body: "INTERNAL-NOTE-SECRET-XYZ" } });
    await prisma.aiAnalysis.create({ data: { ticketId: ticket.id, promptVersion: "v1", status: "FAILED", errorCode: "AI_RATIONALE_SECRET" } });

    const a = await login(app, config, authorA!.email);
    const detail = await a.agent.get(`/api/v1/author/tickets/${ticket.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.messages.map((m: { body: string }) => m.body)).toEqual(["Visible reply to author", "Author follow-up"]);
    expect(detail.body.messages.every((m: { visibility: string }) => m.visibility === "AUTHOR")).toBe(true);
    const everything = [detail, await a.agent.get("/api/v1/author/tickets"), await a.agent.get(`/api/v1/author/tickets/${ticket.id}/attachments`)];
    for (const response of everything) expect(JSON.stringify(response.body)).not.toMatch(/XYZ|AI_RATIONALE_SECRET|internalNotes|aiAnalysis|auditEvents/);
  });
});

describe("author access to admin endpoints", () => {
  it("is forbidden for every admin route and method", async () => {
    const pa = await profileFor(prisma, authorA!.author_id);
    const ticket = await makeTicket(prisma, pa.id);
    const a = await login(app, config, authorA!.email);
    for (const url of ["/api/v1/admin/tickets", `/api/v1/admin/tickets/${ticket.id}`, `/api/v1/admin/tickets/${ticket.id}/attachments`]) {
      expect((await a.agent.get(url)).status, url).toBe(403);
    }
    const patch = await mutate(a, "patch", `/api/v1/admin/tickets/${ticket.id}`).send({ status: "CLOSED" });
    expect(patch.status).toBe(403);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe("OPEN");
    expect(await prisma.auditLog.count()).toBe(0);
  });
});
