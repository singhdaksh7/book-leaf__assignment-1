import { loadAiConfig, type AiConfig } from "../src/config.js";
import { AiUnavailableError } from "../src/errors.js";
import type { LlmProvider, LlmRequest, LlmResponse } from "../src/provider/types.js";
import type { UsageRecord } from "../src/usage.js";

// Synthetic placeholder only. Tests never use a real credential or call the live API.
export const FAKE_KEY = "sk-or-test-0000000000000000";

export function testConfig(overrides: Record<string, string> = {}): AiConfig {
  return loadAiConfig({
    OPENROUTER_API_KEY: FAKE_KEY, AI_RETRY_BASE_DELAY_MS: "10", AI_RETRY_MAX_DELAY_MS: "100", AI_TIMEOUT_MS: "1000", ...overrides
  });
}

export const usageFixture: UsageRecord = {
  purpose: "classify", model: "test/model", promptTokens: 500, completionTokens: 60, totalTokens: 560,
  costUsd: 0.0001, attempts: 1, fallbackUsed: false, latencyMs: 5
};

export type ScriptedStep = string | Error | object;
export interface ScriptedProvider extends LlmProvider { calls: LlmRequest[]; }

/** Provider double: each call consumes the next step (raw string, object serialised as JSON, or an Error to throw). */
export function scriptedProvider(...steps: ScriptedStep[]): ScriptedProvider {
  const calls: LlmRequest[] = [];
  return {
    calls,
    async complete(request): Promise<LlmResponse> {
      calls.push(request);
      const step = steps[Math.min(calls.length - 1, steps.length - 1)];
      if (step instanceof Error) throw step;
      return { content: typeof step === "string" ? step : JSON.stringify(step), usage: usageFixture };
    }
  };
}

export const timeoutError = () => new AiUnavailableError("AI provider request timed out", "AI_TIMEOUT");

export function modelAnswer(partial: Partial<{ category: string; priority: string; confidence: number; rationale: string; citations: string[] }> = {}) {
  return { category: "GENERAL_INQUIRY", priority: "LOW", confidence: 0.9, rationale: "The author asks a general question.", citations: [], ...partial };
}

export function okEnvelope(content: string, usage: Record<string, unknown> = { prompt_tokens: 400, completion_tokens: 50, total_tokens: 450, cost: 0.00009 }) {
  return { choices: [{ message: { role: "assistant", content } }], usage };
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}
