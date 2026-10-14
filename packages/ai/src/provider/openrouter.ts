import { z } from "zod";
import type { AiConfig } from "../config.js";
import { AiUnavailableError, type AiErrorCode } from "../errors.js";
import type { AiLogger, UsageRecord } from "../usage.js";
import type { LlmProvider, LlmRequest, LlmResponse } from "./types.js";

export interface OpenRouterProviderOptions {
  config: AiConfig;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Returns [0,1); injectable so backoff jitter is deterministic in tests. */
  random?: () => number;
  onUsage?: (usage: UsageRecord) => void;
  logger?: AiLogger;
}

const envelopeSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable().optional() }) })).min(1),
  usage: z.object({
    prompt_tokens: z.number().optional(), completion_tokens: z.number().optional(),
    total_tokens: z.number().optional(), cost: z.number().nullable().optional()
  }).optional()
});
const errorEnvelopeSchema = z.object({ error: z.object({ code: z.union([z.number(), z.string()]).optional() }) });

class CallFailure extends AiUnavailableError {
  constructor(code: AiErrorCode, message: string, readonly retryable: boolean, readonly retryAfterMs?: number) {
    super(message, code);
  }
}

function failureForStatus(status: number, retryAfterMs: number | undefined): CallFailure {
  if (status === 429) return new CallFailure("AI_RATE_LIMITED", "AI provider rate limit reached", true, retryAfterMs);
  if (status === 408 || status >= 500) return new CallFailure("AI_PROVIDER_ERROR", `AI provider error (${status})`, true, retryAfterMs);
  return new CallFailure("AI_PROVIDER_ERROR", `AI provider rejected the request (${status})`, false);
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

type Tokens = Pick<UsageRecord, "model" | "promptTokens" | "completionTokens" | "totalTokens" | "costUsd">;

/**
 * OpenRouter chat-completions adapter. Bounded: at most (maxRetries + 1) calls per model and at most two models
 * (primary, then optional fallback only after a retryable failure). Errors never include provider bodies or the key.
 */
export class OpenRouterProvider implements LlmProvider {
  readonly #config: AiConfig;
  readonly #fetch: typeof fetch;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #random: () => number;
  readonly #onUsage: ((u: UsageRecord) => void) | undefined;
  readonly #logger: AiLogger | undefined;

  constructor(options: OpenRouterProviderOptions) {
    this.#config = options.config;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#random = options.random ?? Math.random;
    this.#onUsage = options.onUsage;
    this.#logger = options.logger;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const { fallbackModel, model } = this.#config;
    const models = fallbackModel && fallbackModel !== model ? [model, fallbackModel] : [model];
    const started = Date.now();
    let attempts = 0;
    let lastError: CallFailure | undefined;

    for (const [index, candidate] of models.entries()) {
      for (let retry = 0; retry <= this.#config.maxRetries; retry += 1) {
        if (retry > 0) await this.#sleep(this.#delay(retry, lastError?.retryAfterMs));
        attempts += 1;
        try {
          const result = await this.#callOnce(candidate, request);
          const usage: UsageRecord = {
            purpose: request.purpose, attempts, fallbackUsed: index > 0, latencyMs: Date.now() - started, ...result.tokens
          };
          this.#onUsage?.(usage);
          return { content: result.content, usage };
        } catch (error) {
          if (!(error instanceof CallFailure)) throw error;
          lastError = error;
          this.#logger?.warn("ai.provider.attempt_failed", {
            code: error.code, model: candidate, attempt: attempts, retryable: error.retryable
          });
          // Non-retryable (auth, bad request, malformed envelope): neither retrying nor a fallback model would help.
          if (!error.retryable) throw new AiUnavailableError(error.message, error.code);
        }
      }
    }
    throw new AiUnavailableError(lastError?.message ?? "AI service is unavailable", lastError?.code ?? "AI_PROVIDER_ERROR");
  }

  #delay(retry: number, retryAfterMs: number | undefined): number {
    const { retryBaseDelayMs, retryMaxDelayMs } = this.#config;
    const exponential = retryBaseDelayMs * 2 ** (retry - 1);
    const jittered = exponential * (0.5 + this.#random() / 2);
    return Math.min(retryMaxDelayMs, Math.max(jittered, retryAfterMs ?? 0));
  }

  async #callOnce(model: string, request: LlmRequest): Promise<{ content: string; tokens: Tokens }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#config.timeoutMs);
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.#config.apiKey.reveal()}`, "Content-Type": "application/json", "X-Title": this.#config.appName
      };
      if (this.#config.appUrl) headers["HTTP-Referer"] = this.#config.appUrl;
      const response = await this.#fetch(`${this.#config.baseUrl}/chat/completions`, {
        method: "POST", headers, signal: controller.signal,
        body: JSON.stringify({
          model, temperature: request.temperature ?? 0,
          max_tokens: Math.min(request.maxOutputTokens ?? this.#config.maxOutputTokens, this.#config.maxOutputTokens),
          response_format: { type: "json_object" }, usage: { include: true },
          messages: [{ role: "system", content: request.system }, { role: "user", content: request.user }]
        })
      });
      if (!response.ok) throw failureForStatus(response.status, parseRetryAfter(response.headers.get("retry-after")));

      let body: unknown;
      try { body = await response.json(); } catch { throw new CallFailure("AI_INVALID_OUTPUT", "AI provider returned an unreadable response", false); }

      const envelope = envelopeSchema.safeParse(body);
      if (!envelope.success) {
        // OpenRouter can answer HTTP 200 with an {error:{code}} body (e.g. an upstream 429/5xx).
        const embedded = errorEnvelopeSchema.safeParse(body);
        if (embedded.success) {
          const code = Number(embedded.data.error.code);
          throw failureForStatus(Number.isInteger(code) && code >= 400 ? code : 502, undefined);
        }
        throw new CallFailure("AI_INVALID_OUTPUT", "AI provider returned an unexpected response shape", false);
      }
      const content = envelope.data.choices[0]?.message.content;
      if (!content || content.trim() === "") throw new CallFailure("AI_INVALID_OUTPUT", "AI provider returned empty content", false);

      const u = envelope.data.usage;
      const promptTokens = u?.prompt_tokens ?? 0;
      const completionTokens = u?.completion_tokens ?? 0;
      return {
        content,
        tokens: { model, promptTokens, completionTokens, totalTokens: u?.total_tokens ?? promptTokens + completionTokens, costUsd: u?.cost ?? null }
      };
    } catch (error) {
      if (error instanceof CallFailure) throw error;
      if (controller.signal.aborted) throw new CallFailure("AI_TIMEOUT", "AI provider request timed out", true);
      throw new CallFailure("AI_NETWORK_ERROR", "AI provider could not be reached", true);
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createOpenRouterProvider(options: OpenRouterProviderOptions): LlmProvider {
  return new OpenRouterProvider(options);
}
