import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { aiAnalysisAttemptSchema, aiAnalysisRequestResponseSchema, aiAnalysisResponseSchema } from "@bookleaf/contracts";
import { PrismaClient } from "@bookleaf/db";
import { AiAttemptService, sanitiseRow } from "../src/ai/attempts.js";
import { createEngineFromModule, createUnavailableEngine, loadPackageEngine } from "../src/ai/engine.js";
import { TicketEventHub } from "../src/events/hub.js";
import { ADMIN_EMAIL, WEB_ORIGIN, createTestApp, loadSyntheticDataset, login, makeTicket, mutate, profileFor, resetDatabase, seedSynthetic } from "./helpers.js";
import { captureLogger, completedRow, failedRow, fakeEngine, gate, sleep } from "./m3helpers.js";

const prisma = new PrismaClient();
const [authorA, authorB] = loadSyntheticDataset();
const valid = { bookId: null, subject: "Royalty not received", description: "I have not received my royalty for last quarter." };

beforeEach(async () => {
  await resetDatabase(prisma);
  await seedSynthetic(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

function setup(options: { engine?: ReturnType<typeof fakeEngine>; service?: Partial<ConstructorParameters<typeof AiAttemptService>[0]> } = {}) {
  const engine = options.engine ?? fakeEngine();
  const events = new TicketEventHub();
  const log = captureLogger();
  const ai = new AiAttemptService({ prisma, engine, events, logger: log.logger, refreshCooldownMs: 0, retryMinGapMs: 0, ...options.service });
  const { app, config } = createTestApp(prisma, { TICKET_CREATE_LIMIT_PER_HOUR: "1000" }, { ai, events, logger: log.logger });
  return { engine, ai, events, app, config, log };
}
const createTicket = async (s: ReturnType<typeof setup>, email = authorA!.email) => {
  const author = await login(s.app, s.config, email);
  const response = await mutate(author, "post", "/api/v1/author/tickets").send(valid);
  expect(response.status).toBe(201);
  return { author, ticketId: response.body.ticket.id as string };
};
const attempts = (ticketId: string) => prisma.aiAnalysis.findMany({ where: { ticketId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

describe("analysis on ticket creation", () => {
  it("persists PENDING with the ticket before the engine runs, then stores the completed result", async () => {
    const release = gate();
    const s = setup({ engine: fakeEngine(async () => { await release.promise; return { row: completedRow(), quality: "MODEL" }; }) });
    const { ticketId } = await createTicket(s);

    const pending = await attempts(ticketId);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ status: "PENDING", category: null, draftResponse: null, errorCode: null });
    const admin = await login(s.app, s.config, ADMIN_EMAIL);
    const during = await admin.agent.get(`/api/v1/admin/tickets/${ticketId}/ai-analysis`);
    expect(aiAnalysisResponseSchema.parse(during.body).analysis).toMatchObject({ status: "PENDING", analysis: null, errorCode: null });

    release.release();
    await s.ai.idle();
    const [done] = await attempts(ticketId);
    expect(done).toMatchObject({
      status: "COMPLETED", category: "ROYALTY_PAYMENTS", priority: "HIGH", confidence: 0.82, citations: ["kb.royalty-policy"],
      model: "test/model-a", inputTokens: 420, outputTokens: 96, costMicrounits: 1234, errorCode: null, promptVersion: "test-v1"
    });
    const after = aiAnalysisResponseSchema.parse((await admin.agent.get(`/api/v1/admin/tickets/${ticketId}/ai-analysis`)).body);
    expect(after.analysis).toMatchObject({ status: "COMPLETED", errorCode: null, analysis: { requiresHumanReview: true, knowledgeBaseCitations: ["kb.royalty-policy"], category: "ROYALTY_PAYMENTS" } });
    expect(JSON.stringify(after)).not.toMatch(/model-a|inputTokens|costMicrounits|promptVersion|1234/);
  });

  it("passes the engine only what it needs: author name, the linked book and author-visible history", async () => {
    const s = setup();
    const pa = await profileFor(prisma, authorA!.author_id);
    const book = await prisma.book.findFirstOrThrow({ where: { authorId: pa.id }, orderBy: { externalBookId: "asc" } });
    const author = await login(s.app, s.config, authorA!.email);
    const created = await mutate(author, "post", "/api/v1/author/tickets").send({ ...valid, bookId: book.id });
    await s.ai.idle();
    const [input] = s.engine.calls;
    expect(input).toMatchObject({ ticketId: created.body.ticket.id, subject: valid.subject, description: valid.description, authorContext: { name: authorA!.name } });
    expect(input?.bookContext).toMatchObject({ title: book.title, status: book.status });
    // Data minimisation: no financial data, identifiers or contact details are handed to the engine at all.
    expect(Object.keys(input?.bookContext ?? {}).sort()).toEqual(["availableOn", "genre", "printPartner", "publicationDate", "status", "title"]);
    for (const key of ["mrp", "authorRoyaltyPerCopy", "totalCopiesSold", "totalRoyaltyEarned", "royaltyPaid", "royaltyPending", "lastRoyaltyPayoutDate", "isbn", "externalBookId", "authorId", "id"]) expect(input?.bookContext).not.toHaveProperty(key);
    expect(JSON.stringify(input)).not.toContain(authorA!.email);
    expect(JSON.stringify(input)).not.toContain(authorA!.phone);
  });

  it("keeps internal notes and admin-only messages out of the engine input", async () => {
    const s = setup();
    const { ticketId } = await createTicket(s);
    await s.ai.idle();
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    await prisma.internalNote.create({ data: { ticketId, authorId: adminUser.id, body: "NOTE-NEVER-TO-MODEL" } });
    await prisma.ticketMessage.create({ data: { ticketId, authorId: adminUser.id, body: "ADMIN-ONLY-NEVER-TO-MODEL", visibility: "ADMIN" } });
    await prisma.ticketMessage.create({ data: { ticketId, authorId: adminUser.id, body: "Shared reply to the author", visibility: "AUTHOR" } });
    const admin = await login(s.app, s.config, ADMIN_EMAIL);
    await mutate(admin, "post", `/api/v1/admin/tickets/${ticketId}/ai-analysis`).send({});
    await s.ai.idle();
    const last = s.engine.calls.at(-1)!;
    expect(JSON.stringify(last)).not.toContain("NEVER-TO-MODEL");
    expect(last.history).toEqual([{ author: "ADMIN", body: "Shared reply to the author" }]);
  });

  it("never sends the draft: no message is created and the ticket is untouched", async () => {
    const s = setup();
    const { ticketId, author } = await createTicket(s);
    await s.ai.idle();
    expect(await prisma.ticketMessage.count()).toBe(0);
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(ticket).toMatchObject({ status: "OPEN", category: null, priority: null, assigneeId: null });
    const detail = await author.agent.get(`/api/v1/author/tickets/${ticketId}`);
    expect(detail.body.messages).toEqual([]);
    expect(JSON.stringify(detail.body)).not.toMatch(/Our team will review|draft|rationale|confidence|citations|kb\./i);
  });

  it("hides analysis from authors entirely", async () => {
    const s = setup();
    const { ticketId, author } = await createTicket(s);
    await s.ai.idle();
    for (const url of [`/api/v1/author/tickets/${ticketId}/ai-analysis`, `/api/v1/admin/tickets/${ticketId}/ai-analysis`]) {
      const response = await author.agent.get(url);
      expect([403, 404], url).toContain(response.status);
      expect(JSON.stringify(response.body)).not.toContain("Our team will review");
    }
    const post = await mutate(author, "post", `/api/v1/admin/tickets/${ticketId}/ai-analysis`).send({});
    expect(post.status).toBe(403);
  });
});

describe("failure handling", () => {
  it("creates the ticket and records a safe FAILED attempt when the provider is down", async () => {
    const s = setup({ engine: fakeEngine(async () => ({ row: failedRow("AI_PROVIDER_ERROR"), quality: "FULL_FALLBACK", retry: "later" })) });
    const { ticketId } = await createTicket(s);
    await s.ai.idle();
    expect(await prisma.ticket.count()).toBe(1);
    const [row] = await attempts(ticketId);
    expect(row).toMatchObject({ status: "FAILED", errorCode: "AI_PROVIDER_ERROR", draftResponse: null, citations: null, category: null });
    const admin = await login(s.app, s.config, ADMIN_EMAIL);
    const view = aiAnalysisResponseSchema.parse((await admin.agent.get(`/api/v1/admin/tickets/${ticketId}/ai-analysis`)).body);
    expect(view.analysis).toMatchObject({ status: "FAILED", analysis: null, errorCode: "AI_PROVIDER_ERROR" });
  });

  it("stores a usable partial fallback as COMPLETED and says so in the (secret-free) log", async () => {
    const s = setup({ engine: fakeEngine(async () => ({ row: completedRow({ confidence: 0.3, model: "test/model-a,test/model-b" }), quality: "PARTIAL_FALLBACK" })) });
    const { ticketId } = await createTicket(s);
    await s.ai.idle();
    const [row] = await attempts(ticketId);
    expect(row).toMatchObject({ status: "COMPLETED", confidence: 0.3, model: "test/model-a,test/model-b" });
    expect(s.log.lines.find((l) => l.message === "ai attempt finished")).toMatchObject({ status: "COMPLETED", quality: "PARTIAL_FALLBACK", attemptId: row!.id });
  });

  it("records a full fallback as FAILED with no draft, keeping usage and an unknown cost null", async () => {
    const s = setup({ engine: fakeEngine(async () => ({ row: failedRow("AI_INVALID_OUTPUT", { model: "test/model-a", inputTokens: 300, outputTokens: 40, costMicrounits: null }), quality: "FULL_FALLBACK", retry: "manual" })) });
    const { ticketId } = await createTicket(s);
    await s.ai.idle();
    const [row] = await attempts(ticketId);
    expect(row).toMatchObject({ status: "FAILED", errorCode: "AI_INVALID_OUTPUT", inputTokens: 300, outputTokens: 40, costMicrounits: null, draftResponse: null });
  });

  it("turns an engine crash into AI_INTERNAL_ERROR without leaking the message", async () => {
    const s = setup({ engine: fakeEngine(async () => { throw new Error("boom sk-live-SECRET-KEY author@example.test"); }) });
    const { ticketId } = await createTicket(s);
    await s.ai.idle();
    const [row] = await attempts(ticketId);
    expect(row).toMatchObject({ status: "FAILED", errorCode: "AI_INTERNAL_ERROR" });
    expect(s.log.text()).not.toMatch(/SECRET-KEY|author@example\.test|boom/);
  });

  it("rejects an invalid COMPLETED row from the engine instead of persisting a half-valid draft", async () => {
    const s = setup({ engine: fakeEngine(async () => ({ row: completedRow({ category: "NOT_A_CATEGORY" as never }), quality: "MODEL" })) });
    const { ticketId } = await createTicket(s);
    await s.ai.idle();
    expect((await attempts(ticketId))[0]).toMatchObject({ status: "FAILED", errorCode: "AI_RESULT_INVALID", draftResponse: null, category: null });
  });

  it("sanitises error codes so provider text or secrets never get stored", () => {
    const row = sanitiseRow(failedRow("Bearer sk-live-SECRET provider said: key invalid"), "v1");
    expect(row.errorCode).toBe("AI_PROVIDER_ERROR");
    expect(sanitiseRow(failedRow("AI_TIMEOUT"), "v1").errorCode).toBe("AI_TIMEOUT");
    expect(sanitiseRow(completedRow({ costMicrounits: -5, inputTokens: 1.5 }), "v1")).toMatchObject({ costMicrounits: null, inputTokens: null, status: "COMPLETED" });
    expect(sanitiseRow(completedRow({ draftResponse: null }), "v1")).toMatchObject({ status: "FAILED", errorCode: "AI_RESULT_INVALID", draftResponse: null });
  });

  it("does not let a hook failure or missing AI affect ticket creation", async () => {
    const app = createTestApp(prisma, { TICKET_CREATE_LIMIT_PER_HOUR: "1000" });
    const author = await login(app.app, app.config, authorA!.email);
    const response = await mutate(author, "post", "/api/v1/author/tickets").send(valid);
    expect(response.status).toBe(201);
    expect(await prisma.aiAnalysis.count()).toBe(0); // no AI service injected: nothing is attempted
    const admin = await login(app.app, app.config, ADMIN_EMAIL);
    const post = await mutate(admin, "post", `/api/v1/admin/tickets/${response.body.ticket.id}/ai-analysis`).send({});
    expect(post.status).toBe(202); // PENDING is persisted first; the unavailable engine then fails it in the background
    expect(aiAnalysisRequestResponseSchema.parse(post.body).analysis.status).toBe("PENDING");
    await vi.waitFor(async () => {
      const view = await admin.agent.get(`/api/v1/admin/tickets/${response.body.ticket.id}/ai-analysis`);
      expect(aiAnalysisResponseSchema.parse(view.body).analysis).toMatchObject({ status: "FAILED", analysis: null, errorCode: "AI_NOT_CONFIGURED" });
    });
  });
});

describe("admin refresh (POST /admin/tickets/:id/ai-analysis)", () => {
  it("returns 202 while pending, joins an in-flight attempt, then 200 once terminal", async () => {
    const release = gate();
    const s = setup({ engine: fakeEngine(async () => { await release.promise; return { row: completedRow(), quality: "MODEL" }; }) });
    const ticket = await makeTicket(prisma, (await profileFor(prisma, authorA!.author_id)).id);
    const admin = await login(s.app, s.config, ADMIN_EMAIL);
    const url = `/api/v1/admin/tickets/${ticket.id}/ai-analysis`;
    const first = await mutate(admin, "post", url).send({});
    expect(first.status).toBe(202);
    expect(aiAnalysisAttemptSchema.parse(first.body.analysis).status).toBe("PENDING");
    const second = await mutate(admin, "post", url).send({});
    expect(second.status).toBe(202);
    expect(second.body.analysis.id).toBe(first.body.analysis.id);
    release.release();
    await s.ai.idle();
    expect(await attempts(ticket.id)).toHaveLength(1);
    expect(s.engine.calls).toHaveLength(1);
    const audit = await prisma.auditLog.findMany({ where: { action: "ticket.ai_analysis.requested" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.after).toEqual({ attemptId: first.body.analysis.id });

    const third = await mutate(admin, "post", url).send({});
    expect(third.status).toBe(202); // cooldown disabled in this setup: an explicit refresh makes a new attempt
    await s.ai.idle();
    expect((await attempts(ticket.id)).map((a) => a.status)).toEqual(["COMPLETED", "COMPLETED"]);
  });

  it("collapses concurrent requests into one attempt and one provider call", async () => {
    const s = setup();
    const ticket = await makeTicket(prisma, (await profileFor(prisma, authorA!.author_id)).id);
    const admin = await login(s.app, s.config, ADMIN_EMAIL);
    const results = await Promise.all(Array.from({ length: 8 }, () => mutate(admin, "post", `/api/v1/admin/tickets/${ticket.id}/ai-analysis`).send({})));
    await s.ai.idle();
    expect(new Set(results.map((r) => r.body.analysis.id)).size).toBeGreaterThanOrEqual(1);
    const rows = await attempts(ticket.id);
    expect(rows.filter((r) => r.status === "PENDING")).toHaveLength(0);
    expect(rows.length).toBe(s.engine.calls.length);
    // With a cooldown, a burst is exactly one attempt.
    await resetDatabase(prisma);
    await seedSynthetic(prisma);
    const guarded = setup({ service: { refreshCooldownMs: 60_000 } });
    const t2 = await makeTicket(prisma, (await profileFor(prisma, authorA!.author_id)).id);
    const admin2 = await login(guarded.app, guarded.config, ADMIN_EMAIL);
    const burst = await Promise.all(Array.from({ length: 8 }, () => mutate(admin2, "post", `/api/v1/admin/tickets/${t2.id}/ai-analysis`).send({})));
    await guarded.ai.idle();
    expect(new Set(burst.map((r) => r.body.analysis.id)).size).toBe(1);
    expect(await attempts(t2.id)).toHaveLength(1);
    expect(guarded.engine.calls).toHaveLength(1);
    const again = await mutate(admin2, "post", `/api/v1/admin/tickets/${t2.id}/ai-analysis`).send({});
    expect(again.status).toBe(200); // terminal attempt returned within the cooldown
  });

  it("requires admin, CSRF, an existing open ticket", async () => {
    const s = setup();
    const ticket = await makeTicket(prisma, (await profileFor(prisma, authorA!.author_id)).id);
    const url = `/api/v1/admin/tickets/${ticket.id}/ai-analysis`;
    expect((await request(s.app).post(url).set("Origin", WEB_ORIGIN).send({})).status).toBe(401);
    const admin = await login(s.app, s.config, ADMIN_EMAIL);
    expect((await admin.agent.post(url).set("Origin", WEB_ORIGIN).send({})).status).toBe(403);
    expect((await mutate(admin, "post", "/api/v1/admin/tickets/missing/ai-analysis").send({})).status).toBe(404);
    expect((await admin.agent.get("/api/v1/admin/tickets/missing/ai-analysis")).status).toBe(404);
    await prisma.ticket.update({ where: { id: ticket.id }, data: { status: "CLOSED" } });
    expect((await mutate(admin, "post", url).send({})).status).toBe(409);
    expect(s.engine.calls).toHaveLength(0);
  });

  it("returns null before any attempt exists", async () => {
    const s = setup();
    const ticket = await makeTicket(prisma, (await profileFor(prisma, authorB!.author_id)).id);
    const admin = await login(s.app, s.config, ADMIN_EMAIL);
    expect((await admin.agent.get(`/api/v1/admin/tickets/${ticket.id}/ai-analysis`)).body).toEqual({ analysis: null });
  });
});

describe("durable single-flight", () => {
  it("is enforced by the database: a ticket cannot have two PENDING attempts", async () => {
    const ticket = await makeTicket(prisma, (await profileFor(prisma, authorA!.author_id)).id);
    await prisma.aiAnalysis.create({ data: { ticketId: ticket.id, promptVersion: "v1", status: "PENDING" } });
    await expect(prisma.aiAnalysis.create({ data: { ticketId: ticket.id, promptVersion: "v1", status: "PENDING" } })).rejects.toThrow();
    await prisma.aiAnalysis.create({ data: { ticketId: ticket.id, promptVersion: "v1", status: "FAILED", errorCode: "AI_TIMEOUT" } }); // terminal rows are unrestricted
  });

  it("holds across independent service instances sharing one database", async () => {
    const engine = fakeEngine();
    const one = new AiAttemptService({ prisma, engine, refreshCooldownMs: 60_000 });
    const two = new AiAttemptService({ prisma, engine, refreshCooldownMs: 60_000 });
    const ticket = await makeTicket(prisma, (await profileFor(prisma, authorA!.author_id)).id);
    const results = await Promise.all([one.requestRefresh(ticket.id), two.requestRefresh(ticket.id), one.requestRefresh(ticket.id), two.requestRefresh(ticket.id)]);
    expect(new Set(results.map((r) => r?.attempt.id)).size).toBe(1);
    expect(results.filter((r) => r?.created)).toHaveLength(1);
    expect(await attempts(ticket.id)).toHaveLength(1);
  });
});

describe("abandoned attempts and bounded retries", () => {
  it("closes a stale PENDING attempt, ignores its late result, and retries once", async () => {
    const release = gate();
    const engine = fakeEngine(async () => { await release.promise; return { row: completedRow(), quality: "MODEL" }; }, 40);
    const s = setup({ engine, service: { retryMinGapMs: 0 } });
    const { ticketId } = await createTicket(s);
    await sleep(80);
    engine.behave(async () => ({ row: completedRow({ rationale: "second run" }), quality: "MODEL" }));
    const swept = await s.ai.recover();
    expect(swept.abandoned).toBe(1);
    release.release(); // the original, now-abandoned run finishes late
    await s.ai.idle();

    const rows = await attempts(ticketId);
    expect(rows[0]).toMatchObject({ status: "FAILED", errorCode: "AI_ATTEMPT_ABANDONED", draftResponse: null }); // late result discarded
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ status: "COMPLETED", rationale: "second run" });
    expect((await s.ai.recover()).retried).toBe(0); // latest is COMPLETED: nothing more to do
  });

  it("does not touch a PENDING attempt that is still within its window", async () => {
    const release = gate();
    const s = setup({ engine: fakeEngine(async () => { await release.promise; return { row: completedRow(), quality: "MODEL" }; }, 60_000) });
    const { ticketId } = await createTicket(s);
    expect(await s.ai.recover()).toEqual({ abandoned: 0, retried: 0 });
    release.release();
    await s.ai.idle();
    expect((await attempts(ticketId))[0]?.status).toBe("COMPLETED");
  });

  it("recovers a PENDING row left by a crashed process (no run ever started)", async () => {
    const s = setup({ engine: fakeEngine(undefined, 1000) });
    const ticket = await makeTicket(prisma, (await profileFor(prisma, authorA!.author_id)).id);
    await prisma.aiAnalysis.create({ data: { ticketId: ticket.id, promptVersion: "v1", status: "PENDING", createdAt: new Date(Date.now() - 60_000) } });
    const result = await s.ai.recover();
    await s.ai.idle();
    expect(result).toEqual({ abandoned: 1, retried: 1 });
    expect((await attempts(ticket.id)).map((r) => r.status)).toEqual(["FAILED", "COMPLETED"]);
  });

  it("retries transient failures at most twice, never the others, and never concurrently", async () => {
    const s = setup({ engine: fakeEngine(async () => ({ row: failedRow("AI_TIMEOUT"), quality: "FULL_FALLBACK", retry: "later" })) });
    const { ticketId } = await createTicket(s);
    await s.ai.idle();
    for (let i = 0; i < 5; i += 1) {
      await Promise.all([s.ai.recover(), s.ai.recover(), s.ai.recover()]); // overlapping sweeps must not double up
      await s.ai.idle();
    }
    const rows = await attempts(ticketId);
    expect(rows).toHaveLength(3); // initial + two retries
    expect(rows.every((r) => r.status === "FAILED" && r.errorCode === "AI_TIMEOUT")).toBe(true);
    expect(s.engine.calls).toHaveLength(3);

    for (const code of ["AI_INVALID_OUTPUT", "AI_UNGROUNDED_OUTPUT", "AI_NOT_CONFIGURED", "AI_INTERNAL_ERROR", "AI_RESULT_INVALID"]) {
      await resetDatabase(prisma);
      await seedSynthetic(prisma);
      const t = setup({ engine: fakeEngine(async () => ({ row: failedRow(code), quality: "FULL_FALLBACK", retry: "manual" })) });
      const created = await createTicket(t);
      await t.ai.idle();
      await t.ai.recover();
      await t.ai.idle();
      expect(await attempts(created.ticketId), code).toHaveLength(1);
    }
  });

  it("respects the minimum gap between retries and skips closed tickets", async () => {
    const s = setup({ engine: fakeEngine(async () => ({ row: failedRow("AI_RATE_LIMITED"), quality: "FULL_FALLBACK", retry: "later" })), service: { retryMinGapMs: 60_000 } });
    const { ticketId } = await createTicket(s);
    await s.ai.idle();
    expect(await s.ai.recover()).toEqual({ abandoned: 0, retried: 0 });
    await prisma.aiAnalysis.updateMany({ data: { createdAt: new Date(Date.now() - 120_000) } });
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: "CLOSED" } });
    expect((await s.ai.recover()).retried).toBe(0);
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: "OPEN" } });
    expect((await s.ai.recover()).retried).toBe(1);
    await s.ai.idle();
  });

  it("limits concurrent provider calls", async () => {
    let active = 0;
    let peak = 0;
    const engine = fakeEngine(async () => { active += 1; peak = Math.max(peak, active); await sleep(40); active -= 1; return { row: completedRow(), quality: "MODEL" }; });
    const s = setup({ engine, service: { maxConcurrent: 2 } });
    const pa = (await profileFor(prisma, authorA!.author_id)).id;
    const tickets = await Promise.all(Array.from({ length: 6 }, () => makeTicket(prisma, pa)));
    await Promise.all(tickets.map((t) => s.ai.requestRefresh(t.id).then((r) => r && s.ai.kick(r.attempt.id))));
    await s.ai.idle();
    expect(peak).toBeLessThanOrEqual(2);
    expect(engine.calls).toHaveLength(6);
  });
});

describe("engine adapter for @bookleaf/ai", () => {
  const log = captureLogger().logger;
  const fakeModule = () => {
    const calls: Array<{ name: string; args: unknown[] }> = [];
    const mod = {
      createAiServiceFromEnv: (...args: unknown[]) => {
        calls.push({ name: "createAiServiceFromEnv", args });
        // Mirror the package's AiLogger contract exactly: only warn(event, meta) exists. A wrong shape must fail here.
        const logger = (args[1] as { logger?: Record<string, unknown> }).logger;
        expect(Object.keys(logger ?? {})).toEqual(["warn"]);
        (logger as { warn: (e: string, m?: object) => void }).warn("ai.provider.attempt_failed", { code: "AI_TIMEOUT" });
        return { service: true };
      },
      loadAiConfig: () => ({ timeoutMs: 1000, maxRetries: 0, retryBaseDelayMs: 0, retryMaxDelayMs: 0, fallbackModel: undefined }),
      worstCaseAnalysisMs: () => 2000,
      ABANDONED_MARGIN_MS: 500,
      UsageTracker: class {},
      pendingRow: () => failedRow("x", { status: "PENDING", errorCode: null, promptVersion: "pkg-v9" }),
      abandonedRow: () => failedRow("AI_ATTEMPT_ABANDONED", { promptVersion: "pkg-v9" }),
      analyzeForPersistence: async (service: unknown, input: unknown) => { calls.push({ name: "analyzeForPersistence", args: [service, input] }); return { status: "COMPLETED", quality: "PARTIAL_FALLBACK", row: completedRow() }; }
    };
    return { mod, calls };
  };

  it("maps the documented package API (create service once, analyzeForPersistence per run)", async () => {
    const { mod, calls } = fakeModule();
    const engine = createEngineFromModule(mod, { OPENROUTER_API_KEY: "k" }, log)!;
    expect(engine).not.toBeNull();
    expect(engine.abandonAfterMs).toBe(2500);
    expect(engine.pendingRow().promptVersion).toBe("pkg-v9");
    const result = await engine.run({ ticketId: "t", subject: "s", description: "d", authorContext: { name: "N" } });
    expect(result).toMatchObject({ quality: "PARTIAL_FALLBACK", row: { status: "COMPLETED" } });
    expect(calls.map((c) => c.name)).toEqual(["createAiServiceFromEnv", "analyzeForPersistence"]);
    expect(calls[1]?.args[0]).toEqual({ service: true });
  });

  it("degrades safely when the package is missing, partial or throwing", async () => {
    expect(createEngineFromModule(null, {}, log)).toBeNull();
    expect(createEngineFromModule({ AiUnavailableError: class {} }, {}, log)).toBeNull(); // the Phase 1 surface
    const unavailable = await loadPackageEngine({}, log, async () => { throw new Error("cannot import"); });
    expect(await unavailable.run({ ticketId: "t", subject: "s", description: "d", authorContext: {} })).toMatchObject({ row: { status: "FAILED", errorCode: "AI_NOT_CONFIGURED" }, retry: "after-config" });
    const phase1 = await loadPackageEngine({}, log); // the real module resolved in this branch today
    expect((await phase1.run({ ticketId: "t", subject: "s", description: "d", authorContext: {} })).row.errorCode).toBe("AI_NOT_CONFIGURED");
    const { mod } = fakeModule();
    mod.analyzeForPersistence = async () => { throw new Error("provider exploded with sk-SECRET"); };
    const crashing = createEngineFromModule(mod, {}, log)!;
    expect(await crashing.run({ ticketId: "t", subject: "s", description: "d", authorContext: {} })).toMatchObject({ row: { status: "FAILED", errorCode: "AI_INTERNAL_ERROR" } });
    expect(createUnavailableEngine().pendingRow().status).toBe("PENDING");
  });
});
