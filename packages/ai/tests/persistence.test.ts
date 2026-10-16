import { aiAnalysisAttemptSchema, aiAnalysisSchema } from "@bookleaf/contracts";
import { describe, expect, it } from "vitest";
import {
  analyzeForPersistence, createAiService, decideAttempt, inputFingerprint, pendingRow, PROMPT_VERSION, retryAdviceFor,
  serializeAttempt, UsageTracker, worstCaseAnalysisMs, type AiAnalysisRowLike, type AnalysisOutcome
} from "../src/index.js";
import { KB_CHUNKS } from "../src/knowledge/chunks.js";
import { modelAnswer, scriptedProvider, testConfig, timeoutError, usageFixture } from "./helpers.js";
import { AiUnavailableError } from "../src/errors.js";

const ticket = { ticketId: "t1", subject: "No royalty", description: "I haven't received any royalty for 6 months", authorContext: { name: "Jane Roe" } };
const goodClass = modelAnswer({ category: "ROYALTY_PAYMENTS", priority: "CRITICAL", citations: ["kb.royalty-policy"] });
const goodDraft = {
  draft: "Dear {{authorFirstName}},\n\nI'm sorry you have waited 6 months. Royalties are calculated quarterly and paid within 45 days of the quarter ending. Our team will review your account and follow up with you.\n\nWarm regards,\nBookLeaf Author Support",
  citations: ["kb.royalty-policy"]
};
const run = (...steps: Parameters<typeof scriptedProvider>) => createAiService({ provider: scriptedProvider(...steps) }).analyzeTicketDetailed(ticket);

describe("audit against the shared TicketAiAnalysis contract", () => {
  it("every outcome path returns exactly the contract fields, requiresHumanReview true, citations from the KB", async () => {
    const paths: Array<Parameters<typeof scriptedProvider>> = [
      [goodClass, goodDraft], [timeoutError()], ["junk", goodDraft], [goodClass, "junk"], [goodClass, timeoutError()]
    ];
    const known = new Set(KB_CHUNKS.map((c) => c.id));
    for (const steps of paths) {
      const { analysis } = await run(...steps);
      expect(aiAnalysisSchema.strict().safeParse(analysis).success).toBe(true);
      expect(analysis.requiresHumanReview).toBe(true);
      expect(analysis.knowledgeBaseCitations.length).toBeGreaterThan(0);
      expect(analysis.knowledgeBaseCitations.every((id) => known.has(id))).toBe(true);
      expect(analysis.confidence).toBeGreaterThanOrEqual(0);
      expect(analysis.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe("attempt state decisions", () => {
  it("model success → COMPLETED/MODEL with full row mapping", async () => {
    const d = decideAttempt(await run(goodClass, goodDraft));
    expect(d).toMatchObject({ status: "COMPLETED", quality: "MODEL" });
    expect(d.row).toEqual({
      status: "COMPLETED", promptVersion: PROMPT_VERSION, model: "test/model", category: "ROYALTY_PAYMENTS", priority: "CRITICAL",
      confidence: 0.9, rationale: "The author asks a general question.", draftResponse: expect.stringContaining("Dear Jane,"),
      citations: ["kb.royalty-policy"], inputTokens: 1000, outputTokens: 120, costMicrounits: 200, errorCode: null
    });
    expect(aiAnalysisAttemptSchema.safeParse({ id: "a", ticketId: "t1", createdAt: new Date().toISOString(), status: "COMPLETED", analysis: aiAnalysisSchema.parse((d as { analysis: unknown }).analysis), errorCode: null }).success).toBe(true);
  });

  it("usable fallbacks stay COMPLETED: template draft after a good classification", async () => {
    const d = decideAttempt(await run(goodClass, timeoutError()));
    expect(d).toMatchObject({ status: "COMPLETED", quality: "PARTIAL_FALLBACK" });
    expect(d.row).toMatchObject({ status: "COMPLETED", errorCode: null, category: "ROYALTY_PAYMENTS" });
  });

  it("usable fallbacks stay COMPLETED: keyword classification with a validated model draft", async () => {
    const outcome = await run("not json", goodDraft);
    expect(outcome.meta.fallbackReasons).toEqual(["AI_INVALID_OUTPUT"]);
    const d = decideAttempt(outcome);
    expect(d).toMatchObject({ status: "COMPLETED", quality: "PARTIAL_FALLBACK" });
    expect(d.row.confidence).toBeLessThanOrEqual(0.3);
  });

  it("rejected-but-billed completions keep their tokens and cost on the row", async () => {
    const d = decideAttempt(await run("not json", "also not json"));
    expect(d.status).toBe("FAILED");
    expect(d.row).toMatchObject({ status: "FAILED", inputTokens: 1000, outputTokens: 120, costMicrounits: 200, errorCode: "AI_INVALID_OUTPUT", category: null, draftResponse: null, citations: null });
  });

  it.each([
    ["AI_TIMEOUT", timeoutError(), "later"],
    ["AI_RATE_LIMITED", new AiUnavailableError("x", "AI_RATE_LIMITED"), "later"],
    ["AI_PROVIDER_ERROR", new AiUnavailableError("x", "AI_PROVIDER_ERROR"), "later"],
    ["AI_NETWORK_ERROR", new AiUnavailableError("x", "AI_NETWORK_ERROR"), "later"],
    ["AI_NOT_CONFIGURED", new AiUnavailableError("x", "AI_NOT_CONFIGURED"), "after-config"]
  ] as const)("provider failure %s → FAILED, no result fields, retry %s", async (code, error, retry) => {
    const outcome = await run(error);
    const d = decideAttempt(outcome);
    expect(d).toMatchObject({ status: "FAILED", errorCode: code, retry });
    expect(d.row).toMatchObject({ status: "FAILED", errorCode: code, category: null, priority: null, confidence: null, rationale: null, draftResponse: null, citations: null, model: null, inputTokens: null, costMicrounits: null });
    // The deterministic analysis is still available to the backend (admin-only template) but is not persisted as a result.
    expect(d.status === "FAILED" && d.fallbackAnalysis.requiresHumanReview).toBe(true);
  });

  it("invalid output on both steps → FAILED, retry manual; a transient reason takes precedence for the code", async () => {
    expect(decideAttempt(await run("junk")).status === "FAILED" && decideAttempt(await run("junk"))).toMatchObject({ errorCode: "AI_INVALID_OUTPUT", retry: "manual" });
    const mixed = decideAttempt(await run("junk", timeoutError()));
    expect(mixed).toMatchObject({ status: "FAILED", errorCode: "AI_TIMEOUT", retry: "later" });
  });

  it("fullFallbackAs: COMPLETED persists the low-confidence fallback instead", async () => {
    const d = decideAttempt(await run(timeoutError()), { fullFallbackAs: "COMPLETED" });
    expect(d).toMatchObject({ status: "COMPLETED", quality: "FULL_FALLBACK" });
    expect(d.row.confidence).toBeLessThanOrEqual(0.3);
  });

  it("fallbackReasons non-empty is not by itself FAILED", async () => {
    const outcome = await run(goodClass, "junk");
    expect(outcome.meta.fallbackReasons.length).toBeGreaterThan(0);
    expect(decideAttempt(outcome).status).toBe("COMPLETED");
  });

  it("retry advice table", () => {
    expect(retryAdviceFor("AI_UNGROUNDED_OUTPUT")).toBe("manual");
    expect(retryAdviceFor("AI_INTERNAL_ERROR")).toBe("manual");
  });
});

describe("cost mapping", () => {
  const withUsage = (usage: AnalysisOutcome["meta"]["usage"], costUsd: number | null, o: AnalysisOutcome): AnalysisOutcome => ({ ...o, meta: { ...o.meta, usage, costUsd } });
  it("keeps null cost null (never 0) and rounds known cost to micro-dollars", async () => {
    const base = await run(goodClass, goodDraft);
    const nullCost = decideAttempt(withUsage([{ ...usageFixture, costUsd: null }], null, base));
    expect(nullCost.row.costMicrounits).toBeNull();
    expect(nullCost.row.inputTokens).toBe(500);
    expect(decideAttempt(withUsage([usageFixture], 0.0000123456, base)).row.costMicrounits).toBe(12);
  });
  it("sums only the reported costs when some calls report none", async () => {
    const o = await run(goodClass, goodDraft);
    const mixed = { ...o, meta: { ...o.meta, usage: [{ ...usageFixture, costUsd: null }, usageFixture], costUsd: 0.0001 } };
    expect(decideAttempt(mixed).row.costMicrounits).toBe(100);
  });
  it("records a fallback model in the model column", async () => {
    const o = await run(goodClass, goodDraft);
    const mixed = { ...o, meta: { ...o.meta, usage: [usageFixture, { ...usageFixture, model: "meta/fallback:free" }] } };
    expect(decideAttempt(mixed).row.model).toBe("test/model,meta/fallback:free");
  });
});

describe("pending row and read mapping (serializeAttempt)", () => {
  const base: AiAnalysisRowLike = {
    id: "a1", ticketId: "t1", createdAt: new Date("2026-01-02T03:04:05.000Z"), status: "COMPLETED", category: "ISBN_METADATA", priority: "HIGH",
    confidence: 0.8, rationale: "r", draftResponse: "d", citations: ["kb.isbn-policy"], errorCode: null
  };
  it("pending row has promptVersion and no result", () => {
    expect(pendingRow()).toMatchObject({ status: "PENDING", promptVersion: PROMPT_VERSION, category: null, citations: null, errorCode: null });
  });
  it("maps COMPLETED rows to the wire attempt, mapping citations and injecting requiresHumanReview", () => {
    expect(serializeAttempt(base)).toEqual({
      id: "a1", ticketId: "t1", createdAt: "2026-01-02T03:04:05.000Z", status: "COMPLETED", errorCode: null,
      analysis: { category: "ISBN_METADATA", priority: "HIGH", confidence: 0.8, rationale: "r", draftResponse: "d", requiresHumanReview: true, knowledgeBaseCitations: ["kb.isbn-policy"] }
    });
  });
  it("accepts an empty citations array but never exposes internal fields", () => {
    const wire = serializeAttempt({ ...base, citations: [], model: "m", inputTokens: 1, costMicrounits: 5 } as AiAnalysisRowLike);
    expect(wire.status === "COMPLETED" && wire.analysis.knowledgeBaseCitations).toEqual([]);
    expect(JSON.stringify(wire)).not.toMatch(/model|inputTokens|costMicrounits|promptVersion/);
  });
  it("maps PENDING and FAILED rows to analysis null", () => {
    expect(serializeAttempt({ ...base, status: "PENDING", category: null, priority: null, confidence: null, rationale: null, draftResponse: null, citations: null }))
      .toMatchObject({ status: "PENDING", analysis: null, errorCode: null });
    expect(serializeAttempt({ ...base, status: "FAILED", errorCode: "AI_TIMEOUT", category: null, citations: null }))
      .toMatchObject({ status: "FAILED", analysis: null, errorCode: "AI_TIMEOUT" });
  });
  it.each([
    ["null citations", { citations: null }],
    ["object citations", { citations: { a: 1 } }],
    ["non-string citation", { citations: ["kb.x", 3] }],
    ["missing draft", { draftResponse: null }],
    ["bad enum", { category: "BILLING" }],
    ["confidence out of range", { confidence: 3 }],
    ["error code on completed", { errorCode: "AI_TIMEOUT" }]
  ])("withholds a malformed COMPLETED row (%s) as FAILED/AI_RESULT_INVALID", (_n, patch) => {
    const wire = serializeAttempt({ ...base, ...patch } as AiAnalysisRowLike);
    expect(wire).toMatchObject({ status: "FAILED", analysis: null, errorCode: "AI_RESULT_INVALID" });
  });
  it("a FAILED row with a blank error code still yields a nonempty code", () => {
    expect(serializeAttempt({ ...base, status: "FAILED", errorCode: " " })).toMatchObject({ errorCode: "AI_PROVIDER_ERROR" });
  });
});

describe("analyzeForPersistence", () => {
  it("never throws: an unexpected analyzer error becomes FAILED/AI_INTERNAL_ERROR without the message", async () => {
    const r = await analyzeForPersistence({ analyzeTicketDetailed: () => Promise.reject(new Error("author secret Jane Roe")) }, ticket);
    expect(r).toMatchObject({ status: "FAILED", errorCode: "AI_INTERNAL_ERROR", retry: "manual", fallbackAnalysis: null, outcome: null });
    expect(JSON.stringify(r)).not.toContain("Jane");
  });
  it("does not mutate its input and produces no ticket or message side effects", async () => {
    const frozen = Object.freeze({ ...ticket, authorContext: Object.freeze({ ...ticket.authorContext }), history: Object.freeze([]) });
    const r = await analyzeForPersistence(createAiService({ provider: scriptedProvider(goodClass, goodDraft) }), frozen as never);
    expect(r.status).toBe("COMPLETED");
    // Output vocabulary: analysis fields + row only; nothing that could change ticket status or create a message.
    expect(Object.keys(r.row).sort()).toEqual(["category", "citations", "confidence", "costMicrounits", "draftResponse", "errorCode", "inputTokens", "model", "outputTokens", "priority", "promptVersion", "rationale", "status"]);
    expect(Object.keys((r as { analysis: object }).analysis)).not.toContain("status");
  });
  it("repeated attempts are independent: a later success is not affected by an earlier failure", async () => {
    let n = 0;
    const flaky = { complete: async (req: Parameters<ReturnType<typeof scriptedProvider>["complete"]>[0]) => {
      n += 1;
      if (n <= 1) throw timeoutError();
      return scriptedProvider(req.purpose === "classify" ? goodClass : goodDraft).complete(req);
    } };
    const tracker = new UsageTracker();
    const service = createAiService({ provider: flaky, usageTracker: tracker });
    const first = await analyzeForPersistence(service, ticket);
    const second = await analyzeForPersistence(service, ticket);
    expect(first).toMatchObject({ status: "FAILED", errorCode: "AI_TIMEOUT", retry: "later" });
    expect(second).toMatchObject({ status: "COMPLETED", quality: "MODEL" });
    expect(second.outcome!.meta.usage).toHaveLength(2); // per-run usage, not cumulative
    expect(tracker.summary().calls).toBe(2);
  });
  it("a repeated identical analysis yields an equal fingerprint, a changed ticket a different one", () => {
    const a = inputFingerprint(ticket);
    expect(inputFingerprint({ ...ticket, description: `  ${ticket.description}\n` })).toBe(a);
    expect(inputFingerprint({ ...ticket, description: ticket.description + " Also my ISBN." })).not.toBe(a);
    expect(inputFingerprint({ ...ticket, bookContext: { status: "Out of Print" } })).not.toBe(a);
    expect(inputFingerprint({ ...ticket, bookContext: { royaltyPending: 5 } })).toBe(inputFingerprint({ ...ticket, bookContext: { royaltyPending: 9 } })); // financial data is not part of the analysis input
    expect(inputFingerprint({ ...ticket, authorContext: { name: "Someone Else" } } as never)).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("royalty");
  });
  it("bounds PENDING staleness from configuration", () => {
    const c = testConfig({ AI_TIMEOUT_MS: "1000", AI_MAX_RETRIES: "2", AI_RETRY_BASE_DELAY_MS: "100", AI_RETRY_MAX_DELAY_MS: "1000" });
    expect(worstCaseAnalysisMs(c)).toBe(2 * (3 * 1000 + 100 + 200));
    expect(worstCaseAnalysisMs({ ...c, fallbackModel: "x/y:free" })).toBe(2 * worstCaseAnalysisMs(c));
  });
});

describe("unavailable providers end to end", () => {
  it("no configuration → FAILED/AI_NOT_CONFIGURED/after-config without network", async () => {
    const { createAiServiceFromEnv } = await import("../src/index.js");
    const r = await analyzeForPersistence(createAiServiceFromEnv({}), ticket);
    expect(r).toMatchObject({ status: "FAILED", errorCode: "AI_NOT_CONFIGURED", retry: "after-config" });
  });
});
