import type { ticketCategories, ticketPriorities } from "@bookleaf/contracts";
import type { Logger } from "../http/logger.js";

/**
 * Backend-owned port over `@bookleaf/ai`. The AI package supplies the classifier/drafter and the pure persistence helpers
 * (`pendingRow`, `analyzeForPersistence`, ...); this file only adapts them. Nothing here classifies or drafts.
 */

/** Plain-data mirror of the package's `AiAnalysisRowData` (same names as the Prisma `AiAnalysis` columns). */
export interface AiRowData {
  status: "PENDING" | "COMPLETED" | "FAILED";
  model: string | null;
  promptVersion: string;
  category: (typeof ticketCategories)[number] | null;
  priority: (typeof ticketPriorities)[number] | null;
  confidence: number | null;
  rationale: string | null;
  draftResponse: string | null;
  citations: string[] | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Millionths of a USD; null when the provider reported no cost (never 0 for unknown). */
  costMicrounits: number | null;
  errorCode: string | null;
}

/** Structural twin of the package's `AnalyzeTicketInput` (knowledge omitted: the package uses its built-in base). */
export interface AiAnalysisInput {
  ticketId: string;
  subject: string;
  description: string;
  authorContext: Record<string, unknown>;
  bookContext?: Record<string, unknown>;
  history?: Array<{ author: "AUTHOR" | "ADMIN"; body: string }>;
}

export type AiQuality = "MODEL" | "PARTIAL_FALLBACK" | "FULL_FALLBACK";
export type AiRetryAdvice = "later" | "manual" | "after-config";

export interface AiRunResult {
  /** COMPLETED rows may be MODEL or PARTIAL_FALLBACK (usable); FULL_FALLBACK defaults to FAILED. */
  row: AiRowData;
  quality: AiQuality;
  retry?: AiRetryAdvice;
}

export interface AiEngine {
  pendingRow(): AiRowData;
  abandonedRow(): AiRowData;
  /** A PENDING attempt older than this can no longer complete (worst-case run time plus margin). */
  abandonAfterMs: number;
  /** Must not throw; any internal failure is reported as a FAILED row. */
  run(input: AiAnalysisInput): Promise<AiRunResult>;
}

/** Error codes for which an automatic delayed retry is allowed (package advice "later"). */
export const retryableErrorCodes: readonly string[] = ["AI_TIMEOUT", "AI_RATE_LIMITED", "AI_PROVIDER_ERROR", "AI_NETWORK_ERROR", "AI_ATTEMPT_ABANDONED"];

const emptyResult = { model: null, category: null, priority: null, confidence: null, rationale: null, draftResponse: null, citations: null, inputTokens: null, outputTokens: null, costMicrounits: null } as const;
const failed = (code: string, promptVersion: string): AiRowData => ({ ...emptyResult, status: "FAILED", promptVersion, errorCode: code });

/** Used when the AI package or its configuration is unavailable. Every analysis records a safe FAILED attempt. */
export function createUnavailableEngine(): AiEngine {
  const promptVersion = "unavailable";
  return {
    pendingRow: () => ({ ...emptyResult, status: "PENDING", promptVersion, errorCode: null }),
    abandonedRow: () => failed("AI_ATTEMPT_ABANDONED", promptVersion),
    abandonAfterMs: 3 * 60_000,
    run: async () => ({ row: failed("AI_NOT_CONFIGURED", promptVersion), quality: "FULL_FALLBACK", retry: "after-config" })
  };
}

type Fn = (...args: never[]) => unknown;
const isFn = (value: unknown): value is Fn => typeof value === "function";
const required = ["createAiServiceFromEnv", "analyzeForPersistence", "pendingRow", "abandonedRow", "worstCaseAnalysisMs", "ABANDONED_MARGIN_MS", "loadAiConfig"] as const;

/** Defaults used for the abandonment window when AI configuration is missing (matches the package defaults). */
const defaultTiming = { timeoutMs: 15_000, maxRetries: 2, retryBaseDelayMs: 500, retryMaxDelayMs: 4_000, fallbackModel: undefined };

/**
 * Builds an engine from the `@bookleaf/ai` module namespace using the documented API (packages/ai README):
 * createAiServiceFromEnv, analyzeForPersistence, pendingRow, abandonedRow, worstCaseAnalysisMs. Returns null if the
 * module does not expose it (e.g. the AI branch is not merged yet) so the caller can degrade to the unavailable engine.
 */
export function createEngineFromModule(mod: unknown, env: Record<string, string | undefined>, logger: Logger): AiEngine | null {
  const m = mod as Record<string, unknown> | null;
  if (!m || required.some((name) => m[name] === undefined) || !required.filter((n) => n !== "ABANDONED_MARGIN_MS").every((n) => isFn(m[n]))) return null;
  const call = <T>(name: string, ...args: unknown[]): T => (m[name] as (...a: unknown[]) => T)(...args);

  const UsageTracker = m.UsageTracker as (new () => unknown) | undefined;
  // The package's AiLogger is `{ warn(event, meta) }` and nothing else. It receives codes and counters only.
  const aiLogger = {
    warn: (event: string, meta?: Record<string, string | number | boolean>) => logger.log("warn", `ai: ${event}`, meta)
  };
  const service = call<unknown>("createAiServiceFromEnv", env, { ...(UsageTracker ? { usageTracker: new UsageTracker() } : {}), logger: aiLogger });

  let timing: unknown = defaultTiming;
  try {
    timing = call<unknown>("loadAiConfig", env);
  } catch {
    // Not configured: analyses will record AI_NOT_CONFIGURED; keep the default abandonment window.
  }
  const abandonAfterMs = call<number>("worstCaseAnalysisMs", timing) + Number(m.ABANDONED_MARGIN_MS);

  return {
    pendingRow: () => call<AiRowData>("pendingRow"),
    abandonedRow: () => call<AiRowData>("abandonedRow"),
    abandonAfterMs,
    async run(input) {
      try {
        // Never log `input` or the outcome: they contain author data.
        const result = await call<Promise<{ row: AiRowData; quality: AiQuality; retry?: AiRetryAdvice }>>("analyzeForPersistence", service, input);
        return { row: result.row, quality: result.quality, ...(result.retry ? { retry: result.retry } : {}) };
      } catch {
        return { row: failed("AI_INTERNAL_ERROR", call<AiRowData>("pendingRow").promptVersion), quality: "FULL_FALLBACK", retry: "manual" };
      }
    }
  };
}

/** Loads the AI package lazily so the API still starts (with AI marked unavailable) when it is absent or incompatible. */
export async function loadPackageEngine(env: Record<string, string | undefined>, logger: Logger, importer: () => Promise<unknown> = () => import("@bookleaf/ai")): Promise<AiEngine> {
  try {
    const engine = createEngineFromModule(await importer(), env, logger);
    if (engine) return engine;
    logger.log("warn", "ai package does not expose the persistence API; analyses will be recorded as AI_NOT_CONFIGURED");
  } catch (error) {
    logger.log("warn", "ai package could not be loaded", { errorName: error instanceof Error ? error.name : "unknown" });
  }
  return createUnavailableEngine();
}
