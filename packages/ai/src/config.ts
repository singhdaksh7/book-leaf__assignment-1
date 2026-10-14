import { z } from "zod";
import { AiUnavailableError } from "./errors.js";

/** Holds a credential so accidental logging/serialisation prints a placeholder, not the value. */
export class Secret {
  readonly #value: string;
  constructor(value: string) { this.#value = value; }
  reveal(): string { return this.#value; }
  toString(): string { return "[REDACTED]"; }
  toJSON(): string { return "[REDACTED]"; }
  [Symbol.for("nodejs.util.inspect.custom")](): string { return "[REDACTED]"; }
}

export interface AiConfig {
  apiKey: Secret;
  baseUrl: string;
  model: string;
  fallbackModel: string | undefined;
  timeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  maxOutputTokens: number;
  appName: string;
  appUrl: string | undefined;
}

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().trim().min(1).optional());
const intInRange = (def: number, min: number, max: number) =>
  z.preprocess(emptyToUndefined, z.coerce.number().int().min(min).max(max).default(def));

const envSchema = z.object({
  OPENROUTER_API_KEY: z.string().trim().min(8),
  OPENROUTER_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().default("https://openrouter.ai/api/v1")),
  OPENROUTER_MODEL: z.preprocess(emptyToUndefined, z.string().trim().min(1).default("openai/gpt-4o-mini")),
  OPENROUTER_FALLBACK_MODEL: optionalString,
  OPENROUTER_APP_NAME: z.preprocess(emptyToUndefined, z.string().trim().min(1).default("BookLeaf Author Support Portal")),
  OPENROUTER_APP_URL: optionalString,
  AI_TIMEOUT_MS: intInRange(15_000, 1_000, 120_000),
  AI_MAX_RETRIES: intInRange(2, 0, 5),
  AI_RETRY_BASE_DELAY_MS: intInRange(500, 0, 10_000),
  AI_RETRY_MAX_DELAY_MS: intInRange(4_000, 0, 60_000),
  AI_MAX_OUTPUT_TOKENS: intInRange(400, 50, 4_000)
});

/**
 * Reads server-side configuration. Throws AiUnavailableError("AI_NOT_CONFIGURED") without echoing any value,
 * so the backend can record a FAILED attempt and keep manual handling available.
 */
export function loadAiConfig(env: Record<string, string | undefined> = process.env): AiConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))].join(", ");
    throw new AiUnavailableError(`AI configuration invalid or missing: ${fields}`, "AI_NOT_CONFIGURED");
  }
  const e = parsed.data;
  const baseUrl = e.OPENROUTER_BASE_URL.replace(/\/+$/, "");
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseUrl);
  if (!baseUrl.startsWith("https://") && !local) {
    throw new AiUnavailableError("AI configuration invalid or missing: OPENROUTER_BASE_URL", "AI_NOT_CONFIGURED");
  }
  return {
    apiKey: new Secret(e.OPENROUTER_API_KEY), baseUrl, model: e.OPENROUTER_MODEL, fallbackModel: e.OPENROUTER_FALLBACK_MODEL,
    timeoutMs: e.AI_TIMEOUT_MS, maxRetries: e.AI_MAX_RETRIES, retryBaseDelayMs: e.AI_RETRY_BASE_DELAY_MS,
    retryMaxDelayMs: Math.max(e.AI_RETRY_MAX_DELAY_MS, e.AI_RETRY_BASE_DELAY_MS),
    maxOutputTokens: e.AI_MAX_OUTPUT_TOKENS, appName: e.OPENROUTER_APP_NAME, appUrl: e.OPENROUTER_APP_URL
  };
}
