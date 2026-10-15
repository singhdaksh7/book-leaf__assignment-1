import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { adminQueueResponseSchema, adminTicketDetailResponseSchema, ticketResponseSchema } from "@bookleaf/contracts";
import { PrismaClient } from "@bookleaf/db";
import { ADMIN_EMAIL, WEB_ORIGIN, createTestApp, loadSyntheticDataset, login, makeTicket, mutate, profileFor, resetDatabase, seedSynthetic } from "./helpers.js";
import { allowedTransitions } from "../src/tickets/transitions.js";

const prisma = new PrismaClient();
const { app, config } = createTestApp(prisma);
const [authorA, authorB] = loadSyntheticDataset();
const day = 86_400_000;
const base = Date.UTC(2026, 0, 1);

beforeEach(async () => {
  await resetDatabase(prisma);
  await seedSynthetic(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

const adminClient = () => login(app, config, ADMIN_EMAIL);

describe("access control", () => {
  it("requires authentication and ADMIN role for every admin route", async () => {
    const pa = await profileFor(prisma, authorA!.author_id);
    const t = await makeTicket(prisma, pa.id);
    for (const url of ["/api/v1/admin/tickets", `/api/v1/admin/tickets/${t.id}`]) expect((await request(app).get(url)).status).toBe(401);
    expect((await request(app).patch(`/api/v1/admin/tickets/${t.id}`).set("Origin", WEB_ORIGIN).send({ status: "CLOSED" })).status).toBe(401);
  });

  it("enforces CSRF and origin on admin mutations", async () => {
    const pa = await profileFor(prisma, authorA!.author_id);
    const t = await makeTicket(prisma, pa.id);
    const admin = await adminClient();
    expect((await admin.agent.patch(`/api/v1/admin/tickets/${t.id}`).set("Origin", WEB_ORIGIN).send({ status: "RESOLVED" })).status).toBe(403);
    expect((await admin.agent.patch(`/api/v1/admin/tickets/${t.id}`).set("Origin", WEB_ORIGIN).set("X-CSRF-Token", "bad").send({ status: "RESOLVED" })).status).toBe(403);
    expect((await admin.agent.patch(`/api/v1/admin/tickets/${t.id}`).set("Origin", "https://evil.example.com").set("X-CSRF-Token", admin.csrf).send({ status: "RESOLVED" })).status).toBe(403);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("OPEN");
  });
});

describe("GET /admin/tickets", () => {
  async function seedQueue() {
    const [pa, pb] = [await profileFor(prisma, authorA!.author_id), await profileFor(prisma, authorB!.author_id)];
    const mk = (subject: string, authorId: string, data: Record<string, unknown>) => makeTicket(prisma, authorId, { subject, ...data });
    const t = {
      lowOld: await mk("low old", pa.id, { status: "OPEN", priority: "LOW", createdAt: new Date(base + day) }),
      critNew: await mk("crit new", pb.id, { status: "OPEN", priority: "CRITICAL", createdAt: new Date(base + 5 * day), category: "ROYALTY_PAYMENTS" }),
      critMid: await mk("crit mid", pa.id, { status: "IN_PROGRESS", priority: "CRITICAL", createdAt: new Date(base + 3 * day), category: "ISBN_METADATA" }),
      unclassified: await mk("unclassified", pb.id, { status: "OPEN", createdAt: new Date(base) }),
      resolved: await mk("resolved", pa.id, { status: "RESOLVED", priority: "HIGH", createdAt: new Date(base + 2 * day), updatedAt: new Date(base + 20 * day) }),
      closed: await mk("closed", pb.id, { status: "CLOSED", priority: "CRITICAL", createdAt: new Date(base + 2 * day), updatedAt: new Date(base + 30 * day) })
    };
    return t;
  }
  const subjects = (body: { items: Array<{ subject: string }> }) => body.items.map((i) => i.subject);

  it("sorts unresolved first by priority then age, then resolved/closed by recent update, and is stable", async () => {
    await seedQueue();
    const admin = await adminClient();
    const response = await admin.agent.get("/api/v1/admin/tickets");
    expect(response.status).toBe(200);
    const body = adminQueueResponseSchema.parse(response.body);
    expect(body.total).toBe(6);
    expect(subjects(body)).toEqual(["crit mid", "crit new", "low old", "unclassified", "closed", "resolved"]);
    // Paging through yields the same total order with no gaps or repeats.
    const paged: string[] = [];
    for (const page of [1, 2, 3, 4]) paged.push(...subjects((await admin.agent.get(`/api/v1/admin/tickets?pageSize=2&page=${page}`)).body));
    expect(paged).toEqual(subjects(body));
  });

  it("sees tickets of every author and applies filters", async () => {
    await seedQueue();
    const admin = await adminClient();
    const q = async (query: string) => subjects((await admin.agent.get(`/api/v1/admin/tickets?${query}`)).body);
    expect(await q("status=OPEN")).toEqual(["crit new", "low old", "unclassified"]);
    expect(await q("priority=CRITICAL")).toEqual(["crit mid", "crit new", "closed"]);
    expect(await q("category=ISBN_METADATA")).toEqual(["crit mid"]);
    expect(await q("status=OPEN&priority=CRITICAL")).toEqual(["crit new"]);
    expect(await q("from=2026-01-03&to=2026-01-04")).toEqual(["crit mid", "closed", "resolved"]);
    expect(await q("from=2026-01-03&to=2026-01-03")).toEqual(["closed", "resolved"]);
    expect(await q("to=2026-01-01")).toEqual(["unclassified"]);
    expect((await admin.agent.get("/api/v1/admin/tickets?status=OPEN&pageSize=1")).body).toMatchObject({ total: 3, page: 1, pageSize: 1 });
  });

  it("rejects invalid filters and unknown parameters", async () => {
    const admin = await adminClient();
    for (const query of ["status=DONE", "priority=URGENT", "category=X", "from=bad", "from=2026-02-01&to=2026-01-01", "pageSize=0", "pageSize=500", "authorId=x", "sort=createdAt"]) {
      const response = await admin.agent.get(`/api/v1/admin/tickets?${query}`);
      expect(response.status, query).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("returns an empty page beyond the end with the real total", async () => {
    await seedQueue();
    const admin = await adminClient();
    expect((await admin.agent.get("/api/v1/admin/tickets?page=9")).body).toEqual({ items: [], page: 9, pageSize: 25, total: 6 });
  });
});

describe("GET /admin/tickets/:id", () => {
  it("returns ticket, author, book, all messages, internal notes, latest AI attempt and audit events", async () => {
    const pa = await profileFor(prisma, authorA!.author_id);
    const book = await prisma.book.findFirstOrThrow({ where: { authorId: pa.id }, orderBy: { externalBookId: "asc" } });
    const ticket = await makeTicket(prisma, pa.id, { bookId: book.id });
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    await prisma.ticketMessage.createMany({ data: [
      { ticketId: ticket.id, authorId: adminUser.id, body: "shared", visibility: "AUTHOR", createdAt: new Date(Date.now() - 1000) },
      { ticketId: ticket.id, authorId: adminUser.id, body: "admin only", visibility: "ADMIN" }
    ] });
    await prisma.internalNote.create({ data: { ticketId: ticket.id, authorId: adminUser.id, body: "private note" } });
    await prisma.aiAnalysis.create({ data: { ticketId: ticket.id, promptVersion: "v1", status: "FAILED", errorCode: "AI_UNAVAILABLE", createdAt: new Date(Date.now() - 5000) } });
    await prisma.aiAnalysis.create({ data: { ticketId: ticket.id, promptVersion: "v1", status: "COMPLETED", category: "ISBN_METADATA", priority: "LOW", confidence: 0.7, rationale: "r", draftResponse: "draft", citations: ["kb-1"] } });

    const admin = await adminClient();
    const response = await admin.agent.get(`/api/v1/admin/tickets/${ticket.id}`);
    expect(response.status).toBe(200);
    const body = adminTicketDetailResponseSchema.parse(response.body);
    expect(body.author.externalAuthorId).toBe(authorA!.author_id);
    expect(body.book?.id).toBe(book.id);
    expect(body.messages.map((m) => m.visibility)).toEqual(["AUTHOR", "ADMIN"]);
    expect(body.internalNotes.map((n) => n.body)).toEqual(["private note"]);
    expect(body.aiAnalysis).toMatchObject({ status: "COMPLETED", errorCode: null, analysis: { requiresHumanReview: true, knowledgeBaseCitations: ["kb-1"], draftResponse: "draft" } });
    expect(JSON.stringify(response.body)).not.toMatch(/promptVersion|costMicrounits|inputTokens|passwordHash/);
  });

  it("returns a null book for general tickets and null AI when there is no attempt", async () => {
    const pa = await profileFor(prisma, authorA!.author_id);
    const ticket = await makeTicket(prisma, pa.id);
    const admin = await adminClient();
    const body = (await admin.agent.get(`/api/v1/admin/tickets/${ticket.id}`)).body;
    expect(body).toMatchObject({ book: null, aiAnalysis: null, messages: [], internalNotes: [], assignments: [], auditEvents: [] });
  });

  it("withholds a malformed stored completed analysis instead of showing a draft", async () => {
    const pa = await profileFor(prisma, authorA!.author_id);
    const ticket = await makeTicket(prisma, pa.id);
    await prisma.aiAnalysis.create({ data: { ticketId: ticket.id, promptVersion: "v1", status: "COMPLETED", category: "GENERAL_INQUIRY", priority: "LOW", confidence: 0.5, rationale: "r", draftResponse: "LEAKED DRAFT", citations: [""] } });
    const admin = await adminClient();
    const response = await admin.agent.get(`/api/v1/admin/tickets/${ticket.id}`);
    expect(response.body.aiAnalysis).toMatchObject({ status: "FAILED", analysis: null, errorCode: "INVALID_STORED_ANALYSIS" });
    expect(JSON.stringify(response.body)).not.toContain("LEAKED DRAFT");
  });

  it("returns 404 for unknown tickets", async () => {
    const admin = await adminClient();
    expect((await admin.agent.get("/api/v1/admin/tickets/missing")).status).toBe(404);
  });
});

describe("PATCH /admin/tickets/:id", () => {
  const patch = async (ticketId: string, body: unknown) => mutate(await adminClient(), "patch", `/api/v1/admin/tickets/${ticketId}`).send(body as object);

  it("changes status, category and priority and writes one append-only audit row per change", async () => {
    const pa = await profileFor(prisma, authorA!.author_id);
    const ticket = await makeTicket(prisma, pa.id, { priority: "LOW" });
    const admin = await adminClient();
    const response = await mutate(admin, "patch", `/api/v1/admin/tickets/${ticket.id}`).set("X-Request-Id", "audit-req-0001").send({ status: "IN_PROGRESS", category: "ROYALTY_PAYMENTS", priority: "CRITICAL" });
    expect(response.status).toBe(200);
    expect(ticketResponseSchema.parse(response.body).ticket).toMatchObject({ status: "IN_PROGRESS", category: "ROYALTY_PAYMENTS", priority: "CRITICAL" });

    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    const audit = await prisma.auditLog.findMany({ orderBy: { action: "asc" } });
    expect(audit.map((a) => a.action)).toEqual(["ticket.category.updated", "ticket.priority.updated", "ticket.status.updated"]);
    expect(audit.every((a) => a.actorId === adminUser.id && a.entityType === "Ticket" && a.entityId === ticket.id && a.requestId === "audit-req-0001")).toBe(true);
    expect(audit.find((a) => a.action === "ticket.priority.updated")).toMatchObject({ before: { priority: "LOW" }, after: { priority: "CRITICAL" } });
    expect(audit.find((a) => a.action === "ticket.category.updated")).toMatchObject({ before: { category: null }, after: { category: "ROYALTY_PAYMENTS" } });

    const detail = await admin.agent.get(`/api/v1/admin/tickets/${ticket.id}`);
    expect(detail.body.auditEvents).toHaveLength(3);
    expect(JSON.stringify(detail.body.auditEvents)).not.toMatch(/"before"|"after"/);
  });

  it("treats unchanged values as a no-op without audit noise", async () => {
    const pa = await profileFor(prisma, authorA!.author_id);
    const ticket = await makeTicket(prisma, pa.id, { priority: "LOW" });
    expect((await patch(ticket.id, { status: "OPEN", priority: "LOW" })).status).toBe(200);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it("follows the documented transition table and rejects everything else with 409", async () => {
    const pa = await profileFor(prisma, authorA!.author_id);
    const statuses = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;
    const admin = await adminClient();
    for (const from of statuses) {
      for (const to of statuses) {
        if (from === to) continue;
        const ticket = await makeTicket(prisma, pa.id, { status: from });
        const response = await mutate(admin, "patch", `/api/v1/admin/tickets/${ticket.id}`).send({ status: to });
        const allowed = (allowedTransitions[from] as readonly string[]).includes(to);
        expect(response.status, `${from}->${to}`).toBe(allowed ? 200 : 409);
        if (!allowed) {
          expect(response.body.error.code).toBe("CONFLICT");
          expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe(from);
        }
      }
    }
    expect(allowedTransitions.CLOSED).toEqual([]);
  });

  it("does not allow any modification of a closed ticket, and a rejected request audits nothing", async () => {
    const pa = await profileFor(prisma, authorA!.author_id);
    const ticket = await makeTicket(prisma, pa.id, { status: "CLOSED" });
    const response = await patch(ticket.id, { category: "GENERAL_INQUIRY", priority: "HIGH" });
    expect(response.status).toBe(409);
    expect(await prisma.auditLog.count()).toBe(0);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).category).toBeNull();
  });

  it("rolls back the ticket change when a combined update is partially invalid", async () => {
    const pa = await profileFor(prisma, authorA!.author_id);
    const ticket = await makeTicket(prisma, pa.id, { status: "RESOLVED" });
    expect((await patch(ticket.id, { priority: "HIGH", status: "BOGUS" })).status).toBe(400);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).priority).toBeNull();
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it("validates input", async () => {
    const pa = await profileFor(prisma, authorA!.author_id);
    const ticket = await makeTicket(prisma, pa.id);
    for (const body of [{}, { status: "DONE" }, { status: "open" }, { priority: "URGENT" }, { priority: 1 }, { category: "OTHER" }, { status: null }]) {
      const response = await patch(ticket.id, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    }
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it("ignores fields outside the contract (no assignee or author changes through PATCH)", async () => {
    const pa = await profileFor(prisma, authorA!.author_id);
    const pb = await profileFor(prisma, authorB!.author_id);
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    const ticket = await makeTicket(prisma, pa.id);
    const response = await patch(ticket.id, { priority: "HIGH", authorId: pb.id, assigneeId: admin.id, description: "rewritten", subject: "rewritten" });
    expect(response.status).toBe(200);
    expect(await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).toMatchObject({ authorId: pa.id, assigneeId: null, subject: "Synthetic subject", priority: "HIGH" });
  });

  it("returns 404 for unknown tickets", async () => {
    expect((await patch("missing", { priority: "HIGH" })).status).toBe(404);
  });

  it("serialises concurrent updates safely", async () => {
    const pa = await profileFor(prisma, authorA!.author_id);
    const ticket = await makeTicket(prisma, pa.id);
    const admin = await adminClient();
    const results = await Promise.all(["RESOLVED", "CLOSED"].map((status) => mutate(admin, "patch", `/api/v1/admin/tickets/${ticket.id}`).send({ status })));
    expect(results.map((r) => r.status).every((s) => s === 200 || s === 409)).toBe(true);
    const final = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    const audits = await prisma.auditLog.findMany({ where: { action: "ticket.status.updated" }, orderBy: { createdAt: "asc" } });
    // Every audited transition chains from the previous state; no lost update.
    expect(audits.at(-1)?.after).toEqual({ status: final.status });
    let previous = "OPEN";
    for (const entry of audits) {
      expect((entry.before as { status: string }).status).toBe(previous);
      previous = (entry.after as { status: string }).status;
    }
  });
});
