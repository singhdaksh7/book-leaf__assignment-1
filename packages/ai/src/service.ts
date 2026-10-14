import { aiAnalysisSchema, type TicketAiAnalysis } from "@bookleaf/contracts";
import { createTicketClassifier, type TicketClassification, type TicketClassifier } from "./classifier/classifier.js";
import { loadAiConfig } from "./config.js";
import { createResponseDrafter, type ResponseDraft, type ResponseDrafter } from "./drafting/drafter.js";
import { AiUnavailableError, type AiErrorCode } from "./errors.js";
import { createKnowledgeRetriever, type KnowledgeRetriever } from "./knowledge/retriever.js";
import { createOpenRouterProvider } from "./provider/openrouter.js";
import type { LlmProvider } from "./provider/types.js";
import type { AiService, AnalyzeTicketInput } from "./types.js";
import type { AiLogger, UsageRecord, UsageTracker } from "./usage.js";
import { KB_VERSION } from "./knowledge/chunks.js";

/** Server-side metadata for persistence/metrics. Not part of the shared contract and never sent to the browser. */
export interface AnalysisMeta {
  kbVersion: string;
  classificationSource: TicketClassification["source"];
  draftSource: ResponseDraft["source"];
  /** Reasons the model result was not used (empty when both steps used the model). */
  fallbackReasons: AiErrorCode[];
  securityFlags: string[];
  /** Every provider completion for this analysis, including those whose output was later rejected. */
  usage: UsageRecord[];
  totalTokens: number;
  /** Sum of provider-reported costs in USD; null when the provider reported none for any call. */
  costUsd: number | null;
}
export interface AnalysisOutcome { analysis: TicketAiAnalysis; meta: AnalysisMeta; }

export interface BookLeafAiServiceOptions {
  classifier: TicketClassifier;
  drafter: ResponseDrafter;
  /** Optional sink for per-call usage (e.g. a UsageTracker). */
  usageTracker?: UsageTracker;
  logger?: AiLogger;
}

/** If the classification call failed at the provider level, a second model call would just repeat the wait. */
const PROVIDER_DOWN: ReadonlySet<AiErrorCode> = new Set(["AI_NOT_CONFIGURED", "AI_TIMEOUT", "AI_RATE_LIMITED", "AI_PROVIDER_ERROR", "AI_NETWORK_ERROR"]);
const FALLBACK_CONFIDENCE_CAP = 0.5;

/**
 * Complete AiService: classify, then draft. This class has no send capability: it returns text for an admin to review,
 * and `requiresHumanReview` is always the literal `true` (enforced by parsing through the shared contract schema).
 */
export class BookLeafAiService implements AiService {
  readonly #classifier: TicketClassifier;
  readonly #drafter: ResponseDrafter;
  readonly #tracker: UsageTracker | undefined;

  constructor(options: BookLeafAiServiceOptions) {
    this.#classifier = options.classifier;
    this.#drafter = options.drafter;
    this.#tracker = options.usageTracker;
  }

  async analyzeTicket(input: AnalyzeTicketInput): Promise<TicketAiAnalysis> {
    return (await this.analyzeTicketDetailed(input)).analysis;
  }

  async analyzeTicketDetailed(input: AnalyzeTicketInput): Promise<AnalysisOutcome> {
    const classification = await this.#classifier.classify(input);
    // A provider outage was already detected by the classifier: skip the second call and use the policy template.
    const providerDown = classification.fallbackReason !== undefined && PROVIDER_DOWN.has(classification.fallbackReason);
    const draft = await this.#drafter.draft(input, classification, providerDown ? classification.fallbackReason : undefined);

    const draftFellBack = draft.source === "fallback";
    const retrieved = new Set([...classification.retrievedChunkIds, ...draft.retrievedChunkIds]);
    const citations = [...new Set([...draft.citations, ...classification.citations])].filter((id) => retrieved.has(id));
    const confidence = draftFellBack ? Math.min(classification.confidence, FALLBACK_CONFIDENCE_CAP) : classification.confidence;

    // Parsing through the shared schema guarantees the exact contract shape and requiresHumanReview === true.
    const analysis = aiAnalysisSchema.parse({
      category: classification.category, priority: classification.priority, confidence,
      rationale: classification.rationale, draftResponse: draft.draft, requiresHumanReview: true, knowledgeBaseCitations: citations
    });

    const usage = [classification.usage, draft.usage].filter((u): u is UsageRecord => u !== null);
    for (const u of usage) this.#tracker?.record(u);
    const costs = usage.map((u) => u.costUsd).filter((c): c is number => c !== null);
    const fallbackReasons = [classification.fallbackReason, draft.fallbackReason].filter((r): r is AiErrorCode => r !== undefined);
    return {
      analysis,
      meta: {
        kbVersion: KB_VERSION, classificationSource: classification.source, draftSource: draft.source, fallbackReasons,
        securityFlags: [...new Set([...classification.securityFlags, ...draft.securityFlags])],
        usage, totalTokens: usage.reduce((n, u) => n + u.totalTokens, 0),
        costUsd: costs.length > 0 ? costs.reduce((a, b) => a + b, 0) : null
      }
    };
  }
}

export interface CreateAiServiceOptions {
  provider: LlmProvider;
  retriever?: KnowledgeRetriever;
  usageTracker?: UsageTracker;
  logger?: AiLogger;
}

export function createAiService(options: CreateAiServiceOptions): BookLeafAiService {
  const retriever = options.retriever ?? createKnowledgeRetriever();
  const shared = { provider: options.provider, retriever, ...(options.logger ? { logger: options.logger } : {}) };
  return new BookLeafAiService({
    classifier: createTicketClassifier(shared), drafter: createResponseDrafter(shared),
    ...(options.usageTracker ? { usageTracker: options.usageTracker } : {}), ...(options.logger ? { logger: options.logger } : {})
  });
}

/**
 * Builds the production service from server-side environment variables. If configuration is missing or invalid the
 * service is still returned and every analysis uses the deterministic fallbacks (reason AI_NOT_CONFIGURED), so
 * ticket handling is never blocked by missing AI credentials. Never call from browser code.
 */
export function createAiServiceFromEnv(
  env: Record<string, string | undefined> = process.env,
  extras: { usageTracker?: UsageTracker; logger?: AiLogger; fetch?: typeof fetch } = {}
): BookLeafAiService {
  let provider: LlmProvider;
  try {
    const config = loadAiConfig(env);
    provider = createOpenRouterProvider({
      config, ...(extras.fetch ? { fetch: extras.fetch } : {}), ...(extras.logger ? { logger: extras.logger } : {})
    });
  } catch (error) {
    const code: AiErrorCode = error instanceof AiUnavailableError ? error.code : "AI_NOT_CONFIGURED";
    provider = { complete: () => Promise.reject(new AiUnavailableError("AI is not configured", code)) };
  }
  return createAiService({ provider, ...extras });
}
