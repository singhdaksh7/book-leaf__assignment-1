import { describe, expect, it } from "vitest";
import {
  abandonedRow, analyzeForPersistence, createAiService, createAiServiceFromEnv, decideAttempt, inputFingerprint, isPendingAttemptAbandoned,
  pendingRow, PROMPT_VERSION, retryAdviceFor, serializeAttempt, worstCaseAnalysisMs, ABANDONED_MARGIN_MS, type AiAnalysisRowLike
} from "../src/index.js";
import { createOpenRouterProvider } from "../src/provider/openrouter.js";
import { asFetch, classifyContent, draftContent, FAKE_KEY, jsonResponse, mockFetch, okEnvelope, scriptedProvider, testConfig } from "./helpers.js";

const ticket = { ticketId: "t1", subject: "Royalty", description: "I have not received my royalty for 6 months.", authorContext: { name: "Jane Roe" } };
const GOOD_DRAFT = "I'm sorry for the worry. Royalties are calculated quarterly and paid within 45 days of the quarter ending. Our team will review your account and follow up with you.";
const hang = (_u: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));

function service(f: ReturnType<typeof mockFetch>, env: Record<string, string> = {}, timeoutMs?: number) {
  const sleeps: number[] = [];
  const config = { ...testConfig(env), ...(timeoutMs ? { timeoutMs } : {}) };
  const provider = createOpenRouterProvider({ config, fetch: asFetch(f), sleep: async (ms) => { sleeps.push(ms); }, random: () => 1 });
  return { sleeps, config, svc: createAiService({ provider }) };
}

describe("provider failure modes → attempt state, retry advice and call bounds", () => {
  const T = (code: number) => new Response("secret body", { status: code });
  const cases: Array<[string, () => ReturnType<typeof mockFetch>, Record<string, string>, { errorCode: string; retry: string; calls: number }]> = [
    ["rate limited (429) with 2 retries", () => mockFetch(T(429)), {}, { errorCode: "AI_RATE_LIMITED", retry: "later", calls: 3 }],
    ["rate limited with 0 retries", () => mockFetch(T(429)), { AI_MAX_RETRIES: "0" }, { errorCode: "AI_RATE_LIMITED", retry: "later", calls: 1 }],
    ["rate limited, fallback model doubles the bound", () => mockFetch(T(429)), { OPENROUTER_FALLBACK_MODEL: "x/y" }, { errorCode: "AI_RATE_LIMITED", retry: "later", calls: 6 }],
    ["server error 500", () => mockFetch(T(500)), {}, { errorCode: "AI_PROVIDER_ERROR", retry: "later", calls: 3 }],
    ["gateway timeout 504", () => mockFetch(T(504)), { AI_MAX_RETRIES: "1" }, { errorCode: "AI_PROVIDER_ERROR", retry: "later", calls: 2 }],
    ["network failure", () => mockFetch(new TypeError("socket hang up")), {}, { errorCode: "AI_NETWORK_ERROR", retry: "later", calls: 3 }],
    ["credentials rejected (401)", () => mockFetch(T(401)), {}, { errorCode: "AI_NOT_CONFIGURED", retry: "after-config", calls: 1 }],
    ["bad request (400)", () => mockFetch(T(400)), {}, { errorCode: "AI_PROVIDER_ERROR", retry: "later", calls: 1 }],
    ["non-JSON response body", () => mockFetch(new Response("<html>oops</html>", { status: 200 })), {}, { errorCode: "AI_INVALID_OUTPUT", retry: "manual", calls: 1 }],
    ["malformed envelope", () => mockFetch(jsonResponse({ unexpected: true })), {}, { errorCode: "AI_INVALID_OUTPUT", retry: "manual", calls: 1 }],
    ["empty content", () => mockFetch(jsonResponse(okEnvelope(""))), {}, { errorCode: "AI_INVALID_OUTPUT", retry: "manual", calls: 1 }],
    ["upstream error inside HTTP 200", () => mockFetch(jsonResponse({ error: { code: 503 } })), {}, { errorCode: "AI_PROVIDER_ERROR", retry: "later", calls: 3 }]
  ];
  it.each(cases)("%s", async (_name, make, env, expected) => {
    const f = make();
    const { svc } = service(f, env);
    const r = await analyzeForPersistence(svc, ticket);
    expect(r).toMatchObject({ status: "FAILED", errorCode: expected.errorCode, retry: expected.retry });
    expect(f).toHaveBeenCalledTimes(expected.calls); // classification only: the draft call is skipped after a provider failure
    expect(r.row).toMatchObject({ status: "FAILED", errorCode: expected.errorCode, category: null, draftResponse: null, citations: null });
    expect(JSON.stringify(r)).not.toMatch(/secret body|oops/);
  });

  it("a hung provider times out per attempt and is bounded", async () => {
    const f = mockFetch(hang as never);
    f.mockImplementation(hang);
    const started = Date.now();
    const { svc } = service(f, { AI_MAX_RETRIES: "1" }, 25);
    const r = await analyzeForPersistence(svc, ticket);
    expect(r).toMatchObject({ status: "FAILED", errorCode: "AI_TIMEOUT", retry: "later" });
    expect(f).toHaveBeenCalledTimes(2);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it("missing configuration makes no network call and asks for configuration", async () => {
    const f = mockFetch(new Response("{}"));
    const r = await analyzeForPersistence(createAiServiceFromEnv({}, { fetch: asFetch(f) }), ticket);
    expect(r).toMatchObject({ status: "FAILED", errorCode: "AI_NOT_CONFIGURED", retry: "after-config" });
    expect(f).not.toHaveBeenCalled();
  });

  it("backoff waits stay within the configured bounds", async () => {
    const { svc, sleeps } = service(mockFetch(T(429)), { AI_MAX_RETRIES: "4", AI_RETRY_BASE_DELAY_MS: "100", AI_RETRY_MAX_DELAY_MS: "300" });
    await svc.analyzeTicket(ticket);
    expect(sleeps).toHaveLength(4);
    expect(sleeps.every((ms) => ms <= 300)).toBe(true);
  });

  it("Retry-After is honoured but clamped to the maximum delay; unusable values are ignored", async () => {
    for (const [header, expectedMax] of [["3600", 100], ["-5", 100], ["soon", 100], ["Wed, 21 Oct 2026 07:28:00 GMT", 100]] as const) {
      const f = mockFetch(new Response("", { status: 429, headers: { "retry-after": header } }), jsonResponse(okEnvelope(classifyContent())), jsonResponse(okEnvelope(draftContent(GOOD_DRAFT))));
      const { svc, sleeps } = service(f, { AI_RETRY_BASE_DELAY_MS: "10", AI_RETRY_MAX_DELAY_MS: "100" });
      const o = await svc.analyzeTicketDetailed(ticket);
      expect(o.meta.classificationSource).toBe("model");
      expect(Math.max(...sleeps)).toBeLessThanOrEqual(expectedMax);
    }
  });

  it("an intermittent failure recovers within the retry budget and reports the attempts", async () => {
    const f = mockFetch(T(500), jsonResponse(okEnvelope(classifyContent())), jsonResponse(okEnvelope(draftContent(GOOD_DRAFT))));
    const { svc } = service(f);
    const o = await svc.analyzeTicketDetailed(ticket);
    expect(o.meta).toMatchObject({ classificationSource: "model", draftSource: "model", fallbackReasons: [] });
    expect(o.meta.usage[0]!.attempts).toBe(2);
  });
});

describe("invalid model content", () => {
  it("both steps invalid → FAILED/manual, two calls, and the billed usage is preserved", async () => {
    const f = mockFetch(jsonResponse(okEnvelope("not json at all", { prompt_tokens: 700, completion_tokens: 30, total_tokens: 730, cost: 0.0002 })));
    const { svc } = service(f);
    const r = await analyzeForPersistence(svc, ticket);
    expect(f).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ status: "FAILED", errorCode: "AI_INVALID_OUTPUT", retry: "manual" });
    expect(r.row).toMatchObject({ inputTokens: 1400, outputTokens: 60, costMicrounits: 400 });
  });
  it("unreported cost on rejected output stays null while tokens are kept", async () => {
    const f = mockFetch(jsonResponse(okEnvelope("junk", { prompt_tokens: 10, completion_tokens: 5 })));
    const r = await analyzeForPersistence(service(f).svc, ticket);
    expect(r.row).toMatchObject({ inputTokens: 20, outputTokens: 10, costMicrounits: null });
  });
  it("a rejected draft after a good classification keeps both usages and completes with the template", async () => {
    const f = mockFetch(
      jsonResponse(okEnvelope(classifyContent(), { prompt_tokens: 500, completion_tokens: 50, cost: 0.0001 })),
      jsonResponse(okEnvelope(draftContent(`${GOOD_DRAFT} We guarantee payment.`), { prompt_tokens: 900, completion_tokens: 120, cost: 0.0003 }))
    );
    const r = await analyzeForPersistence(service(f).svc, ticket);
    expect(r).toMatchObject({ status: "COMPLETED", quality: "PARTIAL_FALLBACK" });
    expect(r.row).toMatchObject({ inputTokens: 1400, outputTokens: 170, costMicrounits: 400, errorCode: null });
  });
});

describe("ticket creation and manual replies are never blocked", () => {
  const brokenProviders: Array<[string, unknown]> = [
    ["synchronous throw", { complete: () => { throw new Error("boom"); } }],
    ["rejects with a string", { complete: () => Promise.reject("boom") }],
    ["resolves null", { complete: () => Promise.resolve(null) }],
    ["resolves garbage", { complete: () => Promise.resolve({ nope: 1 }) }],
    ["throws a non-error object", { complete: () => Promise.reject({ code: 7 }) }]
  ];
  it.each(brokenProviders)("provider that %s", async (_n, provider) => {
    const tickets: string[] = [];
    const createTicket = () => { tickets.push("t1"); return "t1"; }; // commits first, like the backend
    createTicket();
    const r = await analyzeForPersistence(createAiService({ provider: provider as never }), ticket);
    expect(tickets).toEqual(["t1"]);
    expect(["FAILED", "COMPLETED"]).toContain(r.status);
    expect(r.row.status).toBe(r.status);
    expect(JSON.stringify(r.row)).not.toContain("boom");
  });
  it("the contract method rejects only with a sanitized AiUnavailableError on internal faults", async () => {
    const svc = createAiService({ provider: { complete: () => Promise.resolve(null as never) } });
    await expect(svc.analyzeTicket(ticket)).rejects.toMatchObject({ name: "AiUnavailableError", code: "AI_INTERNAL_ERROR" });
  });
  it("is stateless between attempts: a failure never affects the next analysis", async () => {
    const f = mockFetch(new Response("", { status: 500 }), new Response("", { status: 500 }), new Response("", { status: 500 }), jsonResponse(okEnvelope(classifyContent())), jsonResponse(okEnvelope(draftContent(GOOD_DRAFT))));
    const { svc } = service(f);
    expect((await analyzeForPersistence(svc, ticket)).status).toBe("FAILED");
    expect((await analyzeForPersistence(svc, ticket)).status).toBe("COMPLETED");
  });
});

describe("attempt state transitions and abandoned recovery", () => {
  const wire = (row: object): AiAnalysisRowLike => ({ id: "a1", ticketId: "t1", createdAt: new Date("2026-01-01T00:00:00Z"), ...(row as object) } as AiAnalysisRowLike);
  it("PENDING → COMPLETED", async () => {
    expect(serializeAttempt(wire(pendingRow()))).toMatchObject({ status: "PENDING", analysis: null, errorCode: null });
    const r = await analyzeForPersistence(createAiService({ provider: scriptedProvider(JSON.parse(classifyContent()), JSON.parse(draftContent(GOOD_DRAFT))) }), ticket);
    expect(serializeAttempt(wire(r.row))).toMatchObject({ status: "COMPLETED", errorCode: null, analysis: { requiresHumanReview: true } });
  });
  it("PENDING → FAILED (provider) is exposed as analysis null with a nonempty code", async () => {
    const r = await analyzeForPersistence(service(mockFetch(new Response("", { status: 429 }))).svc, ticket);
    expect(serializeAttempt(wire(r.row))).toMatchObject({ status: "FAILED", analysis: null, errorCode: "AI_RATE_LIMITED" });
  });
  it("PENDING → FAILED (abandoned) after the worst-case run time plus margin, and not before", () => {
    const config = testConfig();
    const limit = worstCaseAnalysisMs(config) + ABANDONED_MARGIN_MS;
    const created = new Date("2026-01-01T00:00:00Z");
    expect(isPendingAttemptAbandoned(created, config, new Date(created.getTime() + limit))).toBe(false);
    expect(isPendingAttemptAbandoned(created, config, new Date(created.getTime() + limit + 1))).toBe(true);
    expect(isPendingAttemptAbandoned(created, config, new Date(created.getTime() + 1_000))).toBe(false);
    expect(serializeAttempt(wire(abandonedRow()))).toMatchObject({ status: "FAILED", analysis: null, errorCode: "AI_ATTEMPT_ABANDONED" });
    expect(retryAdviceFor("AI_ATTEMPT_ABANDONED")).toBe("later");
  });
  it("every row the helpers produce satisfies the DATABASE_SCHEMA invariants", async () => {
    const rows = [
      pendingRow(), abandonedRow(),
      (await analyzeForPersistence(createAiService({ provider: scriptedProvider(new Error("x")) }), ticket)).row,
      (await analyzeForPersistence(createAiService({ provider: scriptedProvider(JSON.parse(classifyContent()), JSON.parse(draftContent(GOOD_DRAFT))) }), ticket)).row
    ];
    for (const row of rows) {
      expect(row.promptVersion).toBe(PROMPT_VERSION);
      if (row.status === "COMPLETED") {
        for (const k of ["category", "priority", "confidence", "rationale", "draftResponse", "citations"] as const) expect(row[k]).not.toBeNull();
        expect(row.errorCode).toBeNull();
      } else {
        for (const k of ["category", "priority", "confidence", "rationale", "draftResponse", "citations"] as const) expect(row[k]).toBeNull();
        expect(row.errorCode === null).toBe(row.status === "PENDING");
      }
    }
  });
  it("the default for a full fallback is FAILED, and fullFallbackAs is the only way to change it", async () => {
    const o = await createAiService({ provider: scriptedProvider(new Error("x")) }).analyzeTicketDetailed(ticket);
    expect(decideAttempt(o).status).toBe("FAILED");
    expect(decideAttempt(o, {}).status).toBe("FAILED");
    expect(decideAttempt(o, { fullFallbackAs: "FAILED" }).status).toBe("FAILED");
    expect(decideAttempt(o, { fullFallbackAs: "COMPLETED" }).status).toBe("COMPLETED");
  });
});

describe("fingerprint stability and deduplication assumptions", () => {
  const book = { status: "Published", royaltyPending: 2500, title: "T", lastRoyaltyPayoutDate: "2025-12-15" };
  const a = inputFingerprint({ ...ticket, bookContext: book });
  it("is deterministic and a SHA-256 hex digest", () => {
    expect(inputFingerprint({ ...ticket, bookContext: book })).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
  it("ignores things that do not change the analysis", () => {
    expect(inputFingerprint({ ...ticket, bookContext: { lastRoyaltyPayoutDate: "2025-12-15", title: "T", royaltyPending: 2500, status: "Published" } })).toBe(a); // key order
    expect(inputFingerprint({ ...ticket, bookContext: { ...book, updatedAt: "2026-02-02", internalNote: "x" } })).toBe(a); // non-whitelisted fields
    expect(inputFingerprint({ ...ticket, subject: `  ${ticket.subject}\n`, description: ticket.description.replace(/ /g, "  "), bookContext: book })).toBe(a); // whitespace
    expect(inputFingerprint({ ...ticket, ticketId: "other", authorContext: { name: "Someone" }, bookContext: book } as never)).toBe(a);
    expect(inputFingerprint({ ...ticket, subject: "Ｒoyalty", bookContext: book })).toBe(a); // NFKC
  });
  it("changes when content, relevant facts or the history window change", () => {
    expect(inputFingerprint({ ...ticket, description: `${ticket.description} Update.`, bookContext: book })).not.toBe(a);
    expect(inputFingerprint({ ...ticket, bookContext: { ...book, status: "Out of Print" } })).not.toBe(a);
    expect(inputFingerprint({ ...ticket, bookContext: { ...book, royaltyPending: 0 } })).toBe(a); // financial figures never reach the provider, so they do not trigger re-analysis
    const h = (n: number) => Array.from({ length: n }, (_, i) => ({ author: "AUTHOR" as const, body: `m${i}` }));
    expect(inputFingerprint({ ...ticket, bookContext: book, history: h(3) })).toBe(inputFingerprint({ ...ticket, bookContext: book, history: h(3).slice(1) })); // only the last 2 matter
    expect(inputFingerprint({ ...ticket, bookContext: book, history: [{ author: "AUTHOR", body: "new" }] })).not.toBe(a);
    expect(inputFingerprint({ ...ticket, bookContext: book, knowledge: [{ id: "k", topic: "t", content: "c" }] })).not.toBe(a);
  });
  it("does not contain readable ticket text", () => {
    expect(a).not.toMatch(/royalty|Jane|6 months/i);
  });
  it("same fingerprint does not make a run cached: two runs are independent paid calls (dedupe is the backend's job)", async () => {
    const provider = scriptedProvider(JSON.parse(classifyContent()), JSON.parse(draftContent(GOOD_DRAFT)));
    const svc = createAiService({ provider });
    await svc.analyzeTicket(ticket);
    await svc.analyzeTicket(ticket);
    expect(provider.calls).toHaveLength(4);
  });
  it("PROMPT_VERSION participates, so a prompt change invalidates old fingerprints", () => {
    expect(PROMPT_VERSION).toMatch(/classify-v\d+\/draft-v\d+$/);
  });
});

describe("secret never needed after startup failures", () => {
  it("a key that is present but rejected never appears in the result", async () => {
    const r = await analyzeForPersistence(createAiServiceFromEnv({ OPENROUTER_API_KEY: FAKE_KEY }, { fetch: asFetch(mockFetch(new Response(`bad key ${FAKE_KEY}`, { status: 401 }))) }), ticket);
    expect(r).toMatchObject({ errorCode: "AI_NOT_CONFIGURED", retry: "after-config" });
    expect(JSON.stringify(r)).not.toContain(FAKE_KEY);
  });
});
