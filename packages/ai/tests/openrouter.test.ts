import { describe, expect, it, vi } from "vitest";
import { loadAiConfig } from "../src/config.js";
import { AiUnavailableError } from "../src/errors.js";
import { OpenRouterProvider } from "../src/provider/openrouter.js";
import { UsageTracker, type UsageRecord } from "../src/usage.js";
import { FAKE_KEY, jsonResponse, okEnvelope, testConfig } from "./helpers.js";

const request = { purpose: "classify", system: "sys", user: "usr" };
const noSleep = () => Promise.resolve();

function provider(fetchImpl: typeof fetch, overrides: Record<string, string> = {}, extra: Partial<ConstructorParameters<typeof OpenRouterProvider>[0]> = {}) {
  return new OpenRouterProvider({ config: testConfig(overrides), fetch: fetchImpl, sleep: noSleep, random: () => 0.5, ...extra });
}
const mockFetch = (...steps: Array<Response | Error | (() => Promise<Response>)>) => {
  const fn = vi.fn(async () => {
    const step = steps[Math.min(fn.mock.calls.length - 1, steps.length - 1)];
    if (step instanceof Error) throw step;
    return typeof step === "function" ? step() : step!.clone();
  });
  return fn;
};

describe("loadAiConfig", () => {
  it("applies defaults and keeps the key redacted when serialised or logged", () => {
    const c = loadAiConfig({ OPENROUTER_API_KEY: FAKE_KEY });
    expect(c).toMatchObject({ model: "nvidia/nemotron-3-super-120b-a12b:free", maxRetries: 2, timeoutMs: 15000, baseUrl: "https://openrouter.ai/api/v1" });
    expect(JSON.stringify(c)).not.toContain(FAKE_KEY);
    expect(String(c.apiKey)).toBe("[REDACTED]");
    expect(c.apiKey.reveal()).toBe(FAKE_KEY);
  });
  it("fails closed with a sanitized error when the key is missing, without echoing values", () => {
    expect.assertions(2);
    try { loadAiConfig({ AI_TIMEOUT_MS: "999999999" }); } catch (e) {
      expect(e).toMatchObject({ code: "AI_NOT_CONFIGURED" });
      expect((e as Error).message).not.toContain("999999999");
    }
  });
  it("rejects plain-http remote base URLs", () => {
    expect(() => loadAiConfig({ OPENROUTER_API_KEY: FAKE_KEY, OPENROUTER_BASE_URL: "http://evil.example/v1" })).toThrow(/OPENROUTER_BASE_URL/);
  });
});

describe("OpenRouterProvider", () => {
  it("sends the key server-side as a bearer header, requests JSON and tracks usage", async () => {
    const tracker = new UsageTracker();
    const f = mockFetch(jsonResponse(okEnvelope('{"a":1}')));
    const res = await provider(f as unknown as typeof fetch, {}, { onUsage: (u) => tracker.record(u) }).complete(request);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${FAKE_KEY}`);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: "nvidia/nemotron-3-super-120b-a12b:free", temperature: 0, max_tokens: 400, response_format: { type: "json_object" } });
    expect(res.content).toBe('{"a":1}');
    expect(res.usage).toMatchObject({ promptTokens: 400, completionTokens: 50, totalTokens: 450, costUsd: 0.00009, attempts: 1, fallbackUsed: false });
    expect(tracker.summary()).toMatchObject({ calls: 1, totalTokens: 450, costUsd: 0.00009 });
  });

  it("caps requested output tokens at the configured maximum", async () => {
    const f = mockFetch(jsonResponse(okEnvelope("{}")));
    await provider(f as unknown as typeof fetch).complete({ ...request, maxOutputTokens: 100_000 });
    expect(JSON.parse(((f.mock.calls[0] as unknown) as [string, RequestInit])[1].body as string).max_tokens).toBe(400);
  });

  it("records unknown cost as null rather than zero", async () => {
    const f = mockFetch(jsonResponse(okEnvelope("{}", { prompt_tokens: 1, completion_tokens: 1 })));
    const res = await provider(f as unknown as typeof fetch).complete(request);
    expect(res.usage.costUsd).toBeNull();
    expect(res.usage.totalTokens).toBe(2);
  });

  it("retries 429 honouring Retry-After and then succeeds", async () => {
    const sleeps: number[] = [];
    const f = mockFetch(new Response("{}", { status: 429, headers: { "retry-after": "0.05" } }), jsonResponse(okEnvelope("{}")));
    const res = await provider(f as unknown as typeof fetch, {}, { sleep: async (ms) => { sleeps.push(ms); } }).complete(request);
    expect(f).toHaveBeenCalledTimes(2);
    expect(res.usage.attempts).toBe(2);
    expect(sleeps[0]).toBeGreaterThanOrEqual(50);
  });

  it("bounds retries: maxRetries+1 calls, then a sanitized rate-limit error", async () => {
    const f = mockFetch(new Response("secret provider body", { status: 429 }));
    const err = await provider(f as unknown as typeof fetch, { AI_MAX_RETRIES: "2" }).complete(request).catch((e) => e);
    expect(f).toHaveBeenCalledTimes(3);
    expect(err).toBeInstanceOf(AiUnavailableError);
    expect(err.code).toBe("AI_RATE_LIMITED");
    expect(err.message).not.toContain("secret provider body");
  });

  it("uses exponential backoff capped by the configured maximum", async () => {
    const sleeps: number[] = [];
    const f = mockFetch(new Response("", { status: 503 }));
    await provider(f as unknown as typeof fetch, { AI_MAX_RETRIES: "4", AI_RETRY_BASE_DELAY_MS: "10", AI_RETRY_MAX_DELAY_MS: "30" }, { sleep: async (ms) => { sleeps.push(ms); } })
      .complete(request).catch(() => undefined);
    expect(sleeps).toEqual([7.5, 15, 30, 30]); // jitter factor 0.75 at random()=0.5
  });

  it("retries 5xx, then switches to the fallback model once and flags it in usage", async () => {
    const f = mockFetch(new Response("", { status: 502 }), jsonResponse(okEnvelope("{}")));
    const res = await provider(f as unknown as typeof fetch, { AI_MAX_RETRIES: "0", OPENROUTER_FALLBACK_MODEL: "meta/fallback:free" }).complete(request);
    expect(JSON.parse(((f.mock.calls[1] as unknown) as [string, RequestInit])[1].body as string).model).toBe("meta/fallback:free");
    expect(res.usage).toMatchObject({ model: "meta/fallback:free", fallbackUsed: true, attempts: 2 });
  });

  it.each([[400, "AI_PROVIDER_ERROR"], [402, "AI_PROVIDER_ERROR"], [401, "AI_NOT_CONFIGURED"], [403, "AI_NOT_CONFIGURED"]])(
    "does not retry or fall back on non-retryable %i (%s)", async (status, code) => {
      const f = mockFetch(new Response("", { status }));
      await expect(provider(f as unknown as typeof fetch, { OPENROUTER_FALLBACK_MODEL: "meta/fallback:free" }).complete(request)).rejects.toMatchObject({ code });
      expect(f).toHaveBeenCalledTimes(1);
    });

  it("times out a hung request, retries, and reports AI_TIMEOUT", async () => {
    const hang = (_url: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
    const f = vi.fn(hang);
    const err = await provider(f as unknown as typeof fetch, { AI_TIMEOUT_MS: "1000", AI_MAX_RETRIES: "1" }, {
      config: { ...testConfig({ AI_MAX_RETRIES: "1" }), timeoutMs: 20 }
    }).complete(request).catch((e) => e);
    expect(err).toMatchObject({ code: "AI_TIMEOUT" });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("maps network failures to AI_NETWORK_ERROR without leaking the cause", async () => {
    const f = mockFetch(new TypeError(`fetch failed for key ${FAKE_KEY}`));
    const err = await provider(f as unknown as typeof fetch, { AI_MAX_RETRIES: "1" }).complete(request).catch((e) => e);
    expect(err.code).toBe("AI_NETWORK_ERROR");
    expect(err.message).not.toContain(FAKE_KEY);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("treats an HTTP 200 error envelope with a 429 code as retryable rate limiting", async () => {
    const f = mockFetch(jsonResponse({ error: { code: 429, message: "upstream" } }), jsonResponse(okEnvelope("{}")));
    await expect(provider(f as unknown as typeof fetch).complete(request)).resolves.toMatchObject({ content: "{}" });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["unparseable body", () => new Response("<html>", { status: 200 })],
    ["unexpected shape", () => jsonResponse({ foo: "bar" })],
    ["empty content", () => jsonResponse(okEnvelope("   "))]
  ])("fails with AI_INVALID_OUTPUT on %s and does not retry", async (_name, make) => {
    const f = mockFetch(make());
    await expect(provider(f as unknown as typeof fetch).complete(request)).rejects.toMatchObject({ code: "AI_INVALID_OUTPUT" });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("logs only codes and counters on failure, never prompts or the key", async () => {
    const warn = vi.fn();
    const f = mockFetch(new Response("", { status: 500 }));
    await provider(f as unknown as typeof fetch, { AI_MAX_RETRIES: "0" }, { logger: { warn } }).complete({ ...request, user: "AUTHOR-PRIVATE-TEXT" }).catch(() => undefined);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("AI_PROVIDER_ERROR");
    expect(logged).not.toContain("AUTHOR-PRIVATE-TEXT");
    expect(logged).not.toContain(FAKE_KEY);
  });

  it("never invokes onUsage for failed calls", async () => {
    const onUsage = vi.fn((_: UsageRecord) => undefined);
    await provider(mockFetch(new Response("", { status: 500 })) as unknown as typeof fetch, { AI_MAX_RETRIES: "0" }, { onUsage }).complete(request).catch(() => undefined);
    expect(onUsage).not.toHaveBeenCalled();
  });
});

describe("zero-spend model guard", () => {
  it.each([
    [{ OPENROUTER_MODEL: "openai/gpt-4o-mini" }],
    [{ OPENROUTER_FALLBACK_MODEL: "anthropic/claude-sonnet-4" }],
    [{ OPENROUTER_MODEL: "openrouter/auto" }]
  ])("rejects a non-free model against the real provider %j", (env) => {
    expect(() => testConfig(env)).toThrow(/free/);
  });
  it("allows the default free model and a free fallback", () => {
    expect(testConfig({ OPENROUTER_FALLBACK_MODEL: "google/gemma-4-31b-it:free" }).model).toBe("nvidia/nemotron-3-super-120b-a12b:free");
  });
  it("exempts loopback endpoints used by the opt-in demonstration mock", () => {
    expect(testConfig({ OPENROUTER_BASE_URL: "http://127.0.0.1:8080/api/v1", OPENROUTER_MODEL: "demo/mock-not-a-real-model" }).model).toBe("demo/mock-not-a-real-model");
  });
});
