import { createHash } from "node:crypto";
import type { AiConfig } from "./config.js";
import type { AiErrorCode } from "./errors.js";
import { pickDraftBookFacts } from "./drafting/prompt.js";
import {
  decideAttempt, failedRow, PROMPT_VERSION, retryAdviceFor,
  type AiAnalysisRowData, type AttemptDecision, type DecisionOptions, type RetryAdvice
} from "./persistence.js";
import type { AnalysisOutcome } from "./service.js";
import type { AnalyzeTicketInput } from "./types.js";

/** Anything with `analyzeTicketDetailed`, e.g. BookLeafAiService. Lets the backend stub the AI in its own tests. */
export interface DetailedAnalyzer { analyzeTicketDetailed(input: AnalyzeTicketInput): Promise<AnalysisOutcome>; }

/** Result of one attempt run. Never throws; always carries a row to persist onto the PENDING attempt. */
export type AttemptResult =
  | AttemptDecision
  | { status: "FAILED"; quality: "FULL_FALLBACK"; row: AiAnalysisRowData; errorCode: AiErrorCode; retry: RetryAdvice; fallbackAnalysis: null; outcome: null };

/**
 * Runs the analysis and maps it to an attempt state. It performs no I/O besides the provider call, does not mutate
 * `input`, and has no ability to send a message or change ticket status: it only returns data for the backend to store.
 * Safe to call again for the same ticket (each run is independent and stateless); see `inputFingerprint` for dedupe.
 */
export async function analyzeForPersistence(analyzer: DetailedAnalyzer, input: AnalyzeTicketInput, options: DecisionOptions = {}): Promise<AttemptResult> {
  try {
    return decideAttempt(await analyzer.analyzeTicketDetailed(input), options);
  } catch {
    // Unexpected programmer/runtime error; the message is deliberately dropped (could contain author data).
    return { status: "FAILED", quality: "FULL_FALLBACK", row: failedRow("AI_INTERNAL_ERROR"), errorCode: "AI_INTERNAL_ERROR", retry: retryAdviceFor("AI_INTERNAL_ERROR"), fallbackAnalysis: null, outcome: null };
  }
}

const squash = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim();

/**
 * Stable hash of everything that can change an analysis: ticket text, the history window, the book facts the prompts
 * use, and the knowledge-base/prompt version. Equal fingerprints mean a re-run would be redundant paid work.
 * The AiAnalysis table has no column for it (see README "Idempotency"), so the backend can compare it only against an
 * in-memory/queue key until a column is approved. Contains no readable author data (SHA-256 hex).
 */
export function inputFingerprint(input: Pick<AnalyzeTicketInput, "subject" | "description" | "history" | "bookContext" | "knowledge">): string {
  const canonical = JSON.stringify({
    v: PROMPT_VERSION, subject: squash(input.subject), description: squash(input.description),
    history: (input.history ?? []).slice(-2).map((h) => [h.author, squash(h.body)]),
    book: pickDraftBookFacts(input.bookContext),
    knowledge: (input.knowledge ?? []).map((k) => [k.id, squash(k.content)])
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Upper bound of one full analysis (classify + draft) in ms, from the configured timeout, retries, backoff and
 * optional fallback model. A PENDING attempt older than this (plus margin) was abandoned (process crash/restart) and
 * may be marked FAILED with `AI_ATTEMPT_ABANDONED` by the backend.
 */
export function worstCaseAnalysisMs(config: Pick<AiConfig, "timeoutMs" | "maxRetries" | "retryBaseDelayMs" | "retryMaxDelayMs" | "fallbackModel">): number {
  let backoff = 0;
  for (let retry = 1; retry <= config.maxRetries; retry += 1) backoff += Math.min(config.retryMaxDelayMs, config.retryBaseDelayMs * 2 ** (retry - 1));
  const perModel = (config.maxRetries + 1) * config.timeoutMs + backoff;
  const models = config.fallbackModel ? 2 : 1;
  return 2 * models * perModel;
}
