export type { AiService, AnalyzeTicketInput, KnowledgeBaseChunk } from "./types.js";
export { AiUnavailableError, type AiErrorCode } from "./errors.js";
export { loadAiConfig, Secret, type AiConfig } from "./config.js";
export { UsageTracker, type UsageRecord, type UsageSummary, type AiLogger } from "./usage.js";
export { CATEGORY_LABELS, type TicketCategory, type TicketPriority } from "./categories.js";

export type { LlmProvider, LlmRequest, LlmResponse } from "./provider/types.js";
export { OpenRouterProvider, createOpenRouterProvider, type OpenRouterProviderOptions } from "./provider/openrouter.js";

export { KB_CHUNKS, KB_VERSION, type KbChunk, type ChunkKind } from "./knowledge/chunks.js";
export { KeywordKnowledgeRetriever, createKnowledgeRetriever, type KnowledgeRetriever, type RetrievalQuery, type RetrievedChunk } from "./knowledge/retriever.js";

export { findUnsupportedClaims, type GroundingIssue, type GroundingSource } from "./grounding.js";
export { detectInjection, sanitizeUntrusted } from "./safety.js";

export { createTicketClassifier, type TicketClassifier, type TicketClassifierOptions, type TicketClassification, type ClassifyTicketInput } from "./classifier/classifier.js";
export { modelClassificationSchema, parseModelClassification, type ModelClassification } from "./classifier/schema.js";
export { DEFAULT_CLASSIFIER_LIMITS, type ClassifierLimits } from "./classifier/prompt.js";

export { createResponseDrafter, type ResponseDrafter, type ResponseDrafterOptions, type ResponseDraft, type DraftTicketInput } from "./drafting/drafter.js";
export { fallbackDraft, greetingName } from "./drafting/fallback.js";
export { DEFAULT_DRAFTER_LIMITS, type DrafterLimits } from "./drafting/prompt.js";
export { BookLeafAiService, createAiService, createAiServiceFromEnv, type AnalysisOutcome, type AnalysisMeta, type CreateAiServiceOptions } from "./service.js";
