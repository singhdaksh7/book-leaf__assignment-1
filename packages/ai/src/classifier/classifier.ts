import { CATEGORY_LABELS, maxPriority, type TicketCategory, type TicketPriority } from "../categories.js";
import { AiUnavailableError, type AiErrorCode } from "../errors.js";
import { findUnsupportedClaims, type GroundingIssue } from "../grounding.js";
import { findUnsafeMarkup } from "../grounding-strict.js";
import { createKnowledgeRetriever, type KnowledgeRetriever, type RetrievedChunk } from "../knowledge/retriever.js";
import type { LlmProvider } from "../provider/types.js";
import { detectInjection } from "../safety.js";
import type { AiLogger, UsageRecord } from "../usage.js";
import type { AnalyzeTicketInput } from "../types.js";
import { heuristicClassify, isLiveMetadataUpdateRequest, policyPriority, priorityFloor } from "./heuristics.js";
import { buildClassifierPrompt, DEFAULT_CLASSIFIER_LIMITS, pickBookFacts, type ClassifierLimits } from "./prompt.js";
import { parseModelClassification } from "./schema.js";

export type ClassifyTicketInput = Pick<AnalyzeTicketInput, "ticketId" | "subject" | "description" | "bookContext" | "history" | "knowledge">;

export interface TicketClassification {
  category: TicketCategory;
  priority: TicketPriority;
  /** 0-1. Heuristic fallback is capped low; injection-suspected tickets are capped at 0.6. */
  confidence: number;
  rationale: string;
  /** Ids of retrieved policy chunks supporting the category; always a subset of `retrievedChunkIds`. */
  citations: string[];
  retrievedChunkIds: string[];
  source: "model" | "heuristic";
  /** Set when source is "heuristic": why the model result was not used. `usage` is still set if a completion was paid for but rejected. */
  fallbackReason?: AiErrorCode;
  /** Prompt-injection heuristics that matched the ticket text (admin-visible signal; classification is unaffected). */
  securityFlags: string[];
  /** Unsupported numbers/dates/completed-action claims removed from the model rationale. */
  groundingIssues: GroundingIssue[];
  usage: UsageRecord | null;
  /** True when the provider call itself failed (outage, rate limit, malformed envelope), not merely unusable model content. */
  providerFailed: boolean;
}

export interface TicketClassifier { classify(input: ClassifyTicketInput): Promise<TicketClassification>; }

export interface TicketClassifierOptions {
  provider: LlmProvider;
  retriever?: KnowledgeRetriever;
  limits?: Partial<ClassifierLimits>;
  logger?: AiLogger;
}

const INJECTION_CONFIDENCE_CAP = 0.6;
const HEURISTIC_CONFIDENCE = { matched: 0.3, ambiguous: 0.2, unmatched: 0.15 };

/**
 * Classifies a ticket into one of the six BookLeaf categories and a priority. Never throws for provider or
 * output problems: those yield a clearly labelled heuristic result so ticket handling continues (admins review all).
 */
export function createTicketClassifier(options: TicketClassifierOptions): TicketClassifier {
  const retriever = options.retriever ?? createKnowledgeRetriever();
  const limits: ClassifierLimits = { ...DEFAULT_CLASSIFIER_LIMITS, ...options.limits };

  return {
    async classify(input) {
      const history = input.history ?? [];
      const ticketText = `${input.subject}\n${input.description}`;
      const securityFlags = detectInjection([ticketText, ...history.map((h) => h.body)].join("\n"));
      const chunks = selectChunks(input, retriever, limits);
      const chunkIds = chunks.map((c) => c.id);
      const bookFacts = pickBookFacts(input.bookContext);

      const fallback = (reason: AiErrorCode, spent: UsageRecord | null = null, providerFailed = false): TicketClassification => {
        options.logger?.warn("ai.classifier.fallback", { reason });
        const h = heuristicClassify(`${ticketText}\n${history.map((m) => m.body).join("\n")}`);
        return {
          category: h.category, priority: h.priority, confidence: !h.matched ? HEURISTIC_CONFIDENCE.unmatched : h.ambiguous ? HEURISTIC_CONFIDENCE.ambiguous : HEURISTIC_CONFIDENCE.matched,
          rationale: "Automatic keyword triage because AI classification was unavailable. Please review.",
          citations: citationsFor(h.category, chunks), retrievedChunkIds: chunkIds, source: "heuristic", fallbackReason: reason,
          securityFlags, groundingIssues: [], usage: spent, providerFailed
        };
      };

      const prompt = buildClassifierPrompt({ subject: input.subject, description: input.description, history, bookFacts, chunks, limits });
      let completion;
      try {
        completion = await options.provider.complete({ purpose: "classify", system: prompt.system, user: prompt.user, maxOutputTokens: limits.maxOutputTokens, temperature: 0 });
      } catch (error) {
        return fallback(error instanceof AiUnavailableError ? error.code : "AI_PROVIDER_ERROR", null, true);
      }

      let parsed;
      try { parsed = parseModelClassification(completion.content); } catch { return fallback("AI_INVALID_OUTPUT", completion.usage); }

      // The model may only cite excerpts it was actually given.
      if (parsed.citations.some((id) => !chunkIds.includes(id))) return fallback("AI_UNGROUNDED_OUTPUT", completion.usage);
      const citations = parsed.citations.length > 0 ? [...new Set(parsed.citations)] : citationsFor(parsed.category, chunks);

      const sources = [
        { text: ticketText }, ...history.map((h) => ({ text: h.body })), { text: JSON.stringify(bookFacts) }, ...chunks.map((c) => ({ text: c.content }))
      ];
      const groundingIssues = [...findUnsupportedClaims(parsed.rationale, sources), ...findUnsafeMarkup(parsed.rationale)];
      const rationale = groundingIssues.length === 0
        ? parsed.rationale
        : `Classified as ${CATEGORY_LABELS[parsed.category]} based on the ticket content. Please review.`;

      const confidence = securityFlags.length > 0 ? Math.min(parsed.confidence, INJECTION_CONFIDENCE_CAP) : parsed.confidence;
      // Deterministic policy rule beats the model: a live-book description/metadata update question is a General Inquiry.
      if (parsed.category !== "GENERAL_INQUIRY" && isLiveMetadataUpdateRequest(ticketText)) {
        return {
          category: "GENERAL_INQUIRY", priority: policyPriority("GENERAL_INQUIRY", ticketText.toLowerCase()), confidence,
          rationale: `Classified as ${CATEGORY_LABELS.GENERAL_INQUIRY}: a request to update a live book's description or metadata. Please review.`,
          citations: citationsFor("GENERAL_INQUIRY", chunks), retrievedChunkIds: chunkIds, source: "model", securityFlags, groundingIssues, usage: completion.usage, providerFailed: false
        };
      }
      return {
        category: parsed.category, priority: maxPriority(parsed.priority, priorityFloor(parsed.category, ticketText)), confidence,
        rationale, citations, retrievedChunkIds: chunkIds, source: "model", securityFlags, groundingIssues, usage: completion.usage, providerFailed: false
      };
    }
  };
}

function citationsFor(category: TicketCategory, chunks: readonly RetrievedChunk[]): string[] {
  return chunks.filter((c) => c.categories.includes(category)).map((c) => c.id);
}

function selectChunks(input: ClassifyTicketInput, retriever: KnowledgeRetriever, limits: ClassifierLimits): RetrievedChunk[] {
  if (input.knowledge && input.knowledge.length > 0) {
    // Backend-supplied knowledge is still capped by the same budget.
    const out: RetrievedChunk[] = [];
    let used = 0;
    for (const k of input.knowledge) {
      if (out.length >= limits.maxChunks || used + k.content.length > limits.maxKbChars) continue;
      used += k.content.length;
      out.push({ id: k.id, topic: k.topic, content: k.content, categories: [], kind: "policy", score: 0 });
    }
    return out;
  }
  return retriever.retrieve({ text: `${input.subject}\n${input.description}`, kinds: ["policy", "overview"], maxChunks: limits.maxChunks, maxChars: limits.maxKbChars });
}
