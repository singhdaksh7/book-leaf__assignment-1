import { describe, expect, it } from "vitest";
import { createAiService, createKnowledgeRetriever, worstCaseAnalysisMs, DEFAULT_CLASSIFIER_LIMITS, DEFAULT_DRAFTER_LIMITS } from "../src/index.js";
import { createOpenRouterProvider } from "../src/provider/openrouter.js";
import { asFetch, classifyContent, draftContent, jsonResponse, mockFetch, okEnvelope, scriptedProvider, testConfig, timeoutError } from "./helpers.js";
import { loadAiConfig } from "../src/config.js";

// Hostile-size input: every limit is exercised at once.
const filler = "royalty isbn print amazon typesetting unavailable payout bank ".repeat(400);
const maxInput = {
  ticketId: "t", subject: filler, description: filler, authorContext: { name: "Jane" },
  history: Array.from({ length: 50 }, () => ({ author: "AUTHOR" as const, body: filler })),
  bookContext: {
    title: "T".repeat(500), status: "S".repeat(500), isbn: "9".repeat(500), genre: "g", publicationDate: "2025-01-01", mrp: 499,
    totalCopiesSold: 10, totalRoyaltyEarned: 1, royaltyPaid: 1, royaltyPending: 2, lastRoyaltyPayoutDate: "2025-12-15",
    printPartner: "P".repeat(500), availableOn: Array.from({ length: 30 }, () => "Amazon India".repeat(10))
  }
};
const chars = (c: { system: string; user: string }) => c.system.length + c.user.length;

describe("prompt size limits (documented in README)", () => {
  it("worst-case prompts stay under fixed ceilings regardless of input size", async () => {
    const p = scriptedProvider(classifyContent(), draftContent("x"));
    await createAiService({ provider: p }).analyzeTicket(maxInput as never);
    const [classify, draft] = p.calls;
    expect(chars(classify!)).toBeLessThan(8_500);   // measured 7.5k chars ≈ 1.9k tokens (English)
    expect(chars(draft!)).toBeLessThan(10_000);     // measured 8.9k chars ≈ 2.3k tokens
    expect(classify!.maxOutputTokens).toBe(DEFAULT_CLASSIFIER_LIMITS.maxOutputTokens);
    expect(draft!.maxOutputTokens).toBe(DEFAULT_DRAFTER_LIMITS.maxOutputTokens);
  });
  it("typical tickets are far smaller", async () => {
    const p = scriptedProvider(classifyContent(), draftContent("x"));
    await createAiService({ provider: p }).analyzeTicket({ ticketId: "t", subject: "Royalty", description: "royalty not received", authorContext: {} });
    expect(chars(p.calls[0]!)).toBeLessThan(3_500);
    expect(chars(p.calls[1]!)).toBeLessThan(5_700);
  });
  it("input fields are truncated at their caps and history is windowed", async () => {
    const p = scriptedProvider(classifyContent(), draftContent("x"));
    const marked = { ...maxInput, history: Array.from({ length: 10 }, (_, i) => ({ author: "AUTHOR" as const, body: `HIST${i} ${"z".repeat(600)}` })) };
    await createAiService({ provider: p }).analyzeTicket(marked as never);
    for (const c of p.calls) {
      expect(c.user).toContain("HIST9");
      expect(c.user).toContain("HIST8");
      expect(c.user).not.toContain("HIST7");
      expect(c.user.split("…[truncated]").length - 1).toBeGreaterThanOrEqual(3); // subject, description, history entries
      expect(c.user).not.toMatch(/z{301}/);
    }
  });
  it("retrieval is capped in chunk count and characters", () => {
    const r = createKnowledgeRetriever();
    const q = { text: filler, kinds: ["policy", "overview", "example", "tone"] as const };
    expect(r.retrieve({ ...q, maxChunks: 3, maxChars: 2_400 }).length).toBeLessThanOrEqual(3);
    expect(r.retrieve({ ...q, maxChunks: 3, maxChars: 2_400 }).reduce((n, c) => n + c.content.length, 0)).toBeLessThanOrEqual(2_400);
    expect(DEFAULT_CLASSIFIER_LIMITS).toMatchObject({ maxChunks: 3, maxKbChars: 2_400 });
    expect(DEFAULT_DRAFTER_LIMITS).toMatchObject({ maxPolicyChunks: 2, maxPolicyChars: 1_800 });
  });
  it("backend-supplied knowledge is capped by the same budget", async () => {
    const p = scriptedProvider(classifyContent(), draftContent("x"));
    const knowledge = Array.from({ length: 20 }, (_, i) => ({ id: `k${i}`, topic: "t", content: "c".repeat(900) }));
    await createAiService({ provider: p }).analyzeTicket({ ...maxInput, knowledge } as never);
    expect((p.calls[0]!.user.match(/^\[k\d+\]/gm) ?? []).length).toBeLessThanOrEqual(2); // 2 x 900 fits 2,400; 3 x 900 does not
    expect((p.calls[1]!.user.match(/^\[k\d+\]/gm) ?? []).length).toBeLessThanOrEqual(2);
  });
});

describe("model calls per analysis", () => {
  const paths: Array<[string, unknown[], number]> = [
    ["both succeed", [classifyContent(), draftContent("Royalties are calculated quarterly and paid within 45 days of the quarter ending. Our team will follow up.")], 2],
    ["classification invalid → still drafts", ["junk", "junk"], 2],
    ["classification provider failure → draft skipped", [timeoutError()], 1],
    ["draft provider failure", [classifyContent(), timeoutError()], 2]
  ];
  it.each(paths)("%s", async (_n, steps, calls) => {
    const p = scriptedProvider(...(steps.map((s) => (typeof s === "string" && s.startsWith("{") ? JSON.parse(s) : s)) as never[]));
    await createAiService({ provider: p }).analyzeTicket({ ticketId: "t", subject: "Royalty", description: "royalty", authorContext: {} });
    expect(p.calls).toHaveLength(calls);
    expect(p.calls.length).toBeLessThanOrEqual(2);
  });
  it("HTTP calls never exceed 2 × (maxRetries + 1) × models, and a provider outage costs only the classification budget", async () => {
    const f = mockFetch(new Response("", { status: 503 }));
    const provider = createOpenRouterProvider({ config: testConfig({ AI_MAX_RETRIES: "3", OPENROUTER_FALLBACK_MODEL: "a/b:free" }), fetch: asFetch(f), sleep: async () => undefined });
    await createAiService({ provider }).analyzeTicket({ ticketId: "t", subject: "x", description: "royalty", authorContext: {} });
    expect(f).toHaveBeenCalledTimes((3 + 1) * 2);
  });
  it("max_tokens on the wire never exceeds AI_MAX_OUTPUT_TOKENS", async () => {
    const f = mockFetch(jsonResponse(okEnvelope(classifyContent())), jsonResponse(okEnvelope(draftContent("x"))));
    const provider = createOpenRouterProvider({ config: testConfig({ AI_MAX_OUTPUT_TOKENS: "120" }), fetch: asFetch(f) });
    await createAiService({ provider }).analyzeTicket({ ticketId: "t", subject: "x", description: "royalty", authorContext: {} });
    for (const [, init] of f.mock.calls as unknown as Array<[string, RequestInit]>) expect(JSON.parse(init.body as string).max_tokens).toBeLessThanOrEqual(120);
  });
});

describe("maximum execution time", () => {
  it("default configuration worst case is exactly documented", () => {
    const c = loadAiConfig({ OPENROUTER_API_KEY: "sk-or-test-0000000000000000" });
    // 2 calls × 1 model × (3 attempts × 15,000 ms + 500 ms + 1,000 ms backoff)
    expect(worstCaseAnalysisMs(c)).toBe(93_000);
    expect(worstCaseAnalysisMs({ ...c, fallbackModel: "a/b:free" })).toBe(186_000);
    expect(worstCaseAnalysisMs({ ...c, maxRetries: 0 })).toBe(30_000);
  });
  it("scales with configuration", () => {
    const c = testConfig({ AI_TIMEOUT_MS: "5000", AI_MAX_RETRIES: "1", AI_RETRY_BASE_DELAY_MS: "200", AI_RETRY_MAX_DELAY_MS: "200" });
    expect(worstCaseAnalysisMs(c)).toBe(2 * (2 * 5000 + 200));
  });
  it("a real outage with a short timeout finishes within the computed bound", async () => {
    const hang = (_u: unknown, init?: RequestInit) => new Promise<Response>((_, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("a", "AbortError"))));
    const f = mockFetch(new Response("")); f.mockImplementation(hang);
    const config = { ...testConfig({ AI_MAX_RETRIES: "1", AI_RETRY_BASE_DELAY_MS: "10", AI_RETRY_MAX_DELAY_MS: "10" }), timeoutMs: 30 };
    const provider = createOpenRouterProvider({ config, fetch: asFetch(f) });
    const started = Date.now();
    await createAiService({ provider }).analyzeTicket({ ticketId: "t", subject: "x", description: "royalty", authorContext: {} });
    expect(Date.now() - started).toBeLessThan(worstCaseAnalysisMs(config) + 500);
    expect(f).toHaveBeenCalledTimes(2); // classification only
  });
});
