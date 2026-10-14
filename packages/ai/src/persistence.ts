import {
  aiAnalysisAttemptSchema, aiAnalysisSchema, ticketCategories, ticketPriorities,
  type AiAnalysisAttempt, type TicketAiAnalysis
} from "@bookleaf/contracts";
import type { AiErrorCode } from "./errors.js";
import { KB_VERSION } from "./knowledge/chunks.js";
import type { AnalysisOutcome } from "./service.js";

/**
 * Persistence mapping for the `AiAnalysis` table (docs/DATABASE_SCHEMA.md). Pure functions over plain data: this
 * package never imports Prisma or touches a database. Field names equal the Prisma model so a row can be passed
 * straight to `create`/`update`; the backend wraps `citations: null` with `Prisma.DbNull`.
 */

/** Written to `promptVersion` (required column). Bump the suffixes when prompts or output schemas change. */
export const PROMPT_VERSION = `${KB_VERSION}/classify-v1/draft-v1`;

export type AttemptStatus = "PENDING" | "COMPLETED" | "FAILED";

export interface AiAnalysisRowData {
  status: AttemptStatus;
  model: string | null;
  promptVersion: string;
  category: (typeof ticketCategories)[number] | null;
  priority: (typeof ticketPriorities)[number] | null;
  confidence: number | null;
  rationale: string | null;
  draftResponse: string | null;
  /** string[] on COMPLETED, otherwise null (use Prisma.DbNull, not JSON null). */
  citations: string[] | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Millionths of a USD; null when the provider reported no cost (never 0 for "unknown"). */
  costMicrounits: number | null;
  errorCode: string | null;
}

const EMPTY_RESULT = {
  model: null, category: null, priority: null, confidence: null, rationale: null, draftResponse: null,
  citations: null, inputTokens: null, outputTokens: null, costMicrounits: null, errorCode: null
} as const;

/** Row to insert before the model call, so a crash leaves a visible PENDING attempt. */
export function pendingRow(): AiAnalysisRowData {
  return { ...EMPTY_RESULT, status: "PENDING", promptVersion: PROMPT_VERSION };
}

export type ResultQuality =
  /** Classification and draft both came from validated model output. */
  | "MODEL"
  /** One step came from the model; the other used the deterministic fallback. Usable, shown to admins as COMPLETED. */
  | "PARTIAL_FALLBACK"
  /** Neither step produced usable model output. */
  | "FULL_FALLBACK";

/** What a backend should do next with a FAILED attempt. */
export type RetryAdvice =
  /** Transient provider condition (timeout, rate limit, 5xx, network): safe to retry later with backoff. */
  | "later"
  /** Model output was unusable: do not auto-loop; an admin may refresh manually. */
  | "manual"
  /** Configuration missing/invalid: retrying cannot help until it is fixed. */
  | "after-config";

const TRANSIENT: ReadonlySet<AiErrorCode> = new Set(["AI_TIMEOUT", "AI_RATE_LIMITED", "AI_PROVIDER_ERROR", "AI_NETWORK_ERROR"]);

export function retryAdviceFor(code: AiErrorCode): RetryAdvice {
  if (TRANSIENT.has(code)) return "later";
  if (code === "AI_NOT_CONFIGURED") return "after-config";
  return "manual";
}

/** Fully classified outcome of one analysis run; `row` is ready to persist onto the PENDING attempt. */
export type AttemptDecision =
  | { status: "COMPLETED"; quality: "MODEL" | "PARTIAL_FALLBACK" | "FULL_FALLBACK"; row: AiAnalysisRowData; analysis: TicketAiAnalysis; outcome: AnalysisOutcome }
  | { status: "FAILED"; quality: "FULL_FALLBACK"; row: AiAnalysisRowData; errorCode: AiErrorCode; retry: RetryAdvice; fallbackAnalysis: TicketAiAnalysis; outcome: AnalysisOutcome };

export interface DecisionOptions {
  /**
   * How to represent FULL_FALLBACK (no usable model output). Default "FAILED": the keyword guess and template are
   * not shown as an AI result, matching docs/AI_DESIGN.md (failure leaves a safe status; admins work manually).
   * "COMPLETED" persists the low-confidence fallback analysis as a usable result instead.
   */
  fullFallbackAs?: "FAILED" | "COMPLETED";
}

const MODEL_COLUMN_MAX = 120;

function usageColumns(outcome: AnalysisOutcome): Pick<AiAnalysisRowData, "model" | "inputTokens" | "outputTokens" | "costMicrounits"> {
  const usage = outcome.meta.usage;
  if (usage.length === 0) return { model: null, inputTokens: null, outputTokens: null, costMicrounits: null };
  const models = [...new Set(usage.map((u) => u.model))].join(",").slice(0, MODEL_COLUMN_MAX);
  return {
    model: models,
    inputTokens: usage.reduce((n, u) => n + u.promptTokens, 0),
    outputTokens: usage.reduce((n, u) => n + u.completionTokens, 0),
    costMicrounits: outcome.meta.costUsd === null ? null : Math.round(outcome.meta.costUsd * 1_000_000)
  };
}

/**
 * Decides the attempt state from a service outcome.
 *
 * | classification | draft     | state                | notes |
 * |----------------|-----------|----------------------|-------|
 * | model          | model     | COMPLETED / MODEL    | normal |
 * | model          | fallback  | COMPLETED / PARTIAL  | template draft: draft call failed or was rejected as ungrounded |
 * | heuristic      | model     | COMPLETED / PARTIAL  | keyword category (confidence ≤ 0.3) with a validated model draft |
 * | heuristic      | fallback  | FAILED (default)     | provider down or all output rejected; errorCode = a transient reason if any, else the first |
 *
 * `meta.fallbackReasons` being non-empty alone never means FAILED. Tokens and cost of rejected completions are kept
 * on every row, because they were still billed.
 */
export function decideAttempt(outcome: AnalysisOutcome, options: DecisionOptions = {}): AttemptDecision {
  const { meta, analysis } = outcome;
  const modelClassification = meta.classificationSource === "model";
  const modelDraft = meta.draftSource === "model";
  const usage = usageColumns(outcome);

  const completedRow = (): AiAnalysisRowData => ({
    status: "COMPLETED", promptVersion: PROMPT_VERSION, ...usage,
    category: analysis.category, priority: analysis.priority, confidence: analysis.confidence, rationale: analysis.rationale,
    draftResponse: analysis.draftResponse, citations: [...analysis.knowledgeBaseCitations], errorCode: null
  });

  if (modelClassification || modelDraft) {
    return { status: "COMPLETED", quality: modelClassification && modelDraft ? "MODEL" : "PARTIAL_FALLBACK", row: completedRow(), analysis, outcome };
  }
  if (options.fullFallbackAs === "COMPLETED") {
    return { status: "COMPLETED", quality: "FULL_FALLBACK", row: completedRow(), analysis, outcome };
  }
  // A transient reason wins so the attempt is retried later rather than treated as bad model output.
  const errorCode: AiErrorCode = meta.fallbackReasons.find((r) => TRANSIENT.has(r)) ?? meta.fallbackReasons[0] ?? "AI_PROVIDER_ERROR";
  return {
    status: "FAILED", quality: "FULL_FALLBACK", errorCode, retry: retryAdviceFor(errorCode), fallbackAnalysis: analysis, outcome,
    row: { ...EMPTY_RESULT, ...usage, status: "FAILED", promptVersion: PROMPT_VERSION, errorCode }
  };
}

/** Row for a run that could not produce an outcome at all (unexpected exception). */
export function failedRow(errorCode: AiErrorCode): AiAnalysisRowData {
  return { ...EMPTY_RESULT, status: "FAILED", promptVersion: PROMPT_VERSION, errorCode };
}

/** Structural subset of the Prisma `AiAnalysis` model, so rows can be passed without importing Prisma. */
export interface AiAnalysisRowLike {
  id: string;
  ticketId: string;
  createdAt: Date;
  status: AttemptStatus;
  category: string | null;
  priority: string | null;
  confidence: number | null;
  rationale: string | null;
  draftResponse: string | null;
  citations: unknown;
  errorCode: string | null;
}

/**
 * Read mapping: row → HTTP `AiAnalysisAttempt` (shared contract). Enforces the state invariants in
 * DATABASE_SCHEMA.md. A COMPLETED row that is malformed is returned as FAILED/`AI_RESULT_INVALID` with no draft:
 * a partial or invalid result is never exposed. Internal fields (model, tokens, cost, promptVersion) are dropped.
 */
export function serializeAttempt(row: AiAnalysisRowLike): AiAnalysisAttempt {
  const base = { id: row.id, ticketId: row.ticketId, createdAt: row.createdAt.toISOString() };
  const failed = (errorCode: string): AiAnalysisAttempt =>
    aiAnalysisAttemptSchema.parse({ ...base, status: "FAILED", analysis: null, errorCode });

  if (row.status === "PENDING") return aiAnalysisAttemptSchema.parse({ ...base, status: "PENDING", analysis: null, errorCode: null });
  if (row.status === "FAILED") return failed(row.errorCode && row.errorCode.trim() !== "" ? row.errorCode : "AI_PROVIDER_ERROR");

  const analysis = aiAnalysisSchema.safeParse({
    category: row.category, priority: row.priority, confidence: row.confidence, rationale: row.rationale,
    draftResponse: row.draftResponse, requiresHumanReview: true, knowledgeBaseCitations: row.citations
  });
  if (!analysis.success || row.errorCode !== null) return failed("AI_RESULT_INVALID");
  return aiAnalysisAttemptSchema.parse({ ...base, status: "COMPLETED", analysis: analysis.data, errorCode: null });
}
