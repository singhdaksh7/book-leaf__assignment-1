import type { TicketCategory, TicketPriority } from "../categories.js";
import { AiUnavailableError, type AiErrorCode } from "../errors.js";
import { findUnsupportedClaims, type GroundingIssue } from "../grounding.js";
import { KB_CHUNKS } from "../knowledge/chunks.js";
import { createKnowledgeRetriever, type KnowledgeRetriever, type RetrievedChunk } from "../knowledge/retriever.js";
import type { LlmProvider } from "../provider/types.js";
import { detectInjection } from "../safety.js";
import type { AnalyzeTicketInput } from "../types.js";
import type { AiLogger, UsageRecord } from "../usage.js";
import { fallbackDraft, greetingName } from "./fallback.js";
import { buildDrafterPrompt, DEFAULT_DRAFTER_LIMITS, pickDraftBookFacts, type DrafterLimits } from "./prompt.js";
import { GREETING_PLACEHOLDER, parseModelDraft } from "./schema.js";

export type DraftTicketInput = Pick<AnalyzeTicketInput, "ticketId" | "subject" | "description" | "bookContext" | "history" | "authorContext" | "knowledge">;

export interface ResponseDraft {
  /** Author-ready text for admin review. Never sent by this package. */
  draft: string;
  /** Subset of `retrievedChunkIds`; always at least one. */
  citations: string[];
  retrievedChunkIds: string[];
  source: "model" | "fallback";
  fallbackReason?: AiErrorCode;
  /** Why a model draft was rejected, if it was. */
  groundingIssues: GroundingIssue[];
  securityFlags: string[];
  usage: UsageRecord | null;
}

export interface ResponseDrafter {
  /** `skipModel`: provider already known to be down, so return the deterministic draft without another call. */
  draft(input: DraftTicketInput, classification: { category: TicketCategory; priority: TicketPriority }, skipModel?: AiErrorCode): Promise<ResponseDraft>;
}
export interface ResponseDrafterOptions {
  provider: LlmProvider;
  retriever?: KnowledgeRetriever;
  limits?: Partial<DrafterLimits>;
  logger?: AiLogger;
}

/** Source: assignment sample for ISBN errors ("Provide a 48-hour resolution timeline"); also in docs/AI_DESIGN.md. */
const ISBN_ESCALATION_TIMELINE = "48 hours";
const TONE = KB_CHUNKS.find((c) => c.kind === "tone")!;

/**
 * Drafts an author reply grounded in retrieved BookLeaf policy. A model draft is accepted only if it passes schema,
 * citation, grounding and strict-claim checks; otherwise a deterministic policy-only draft is returned. Never throws
 * for provider or output problems and never sends anything.
 */
export function createResponseDrafter(options: ResponseDrafterOptions): ResponseDrafter {
  const retriever = options.retriever ?? createKnowledgeRetriever();
  const limits: DrafterLimits = { ...DEFAULT_DRAFTER_LIMITS, ...options.limits };

  return {
    async draft(input, { category, priority }, skipModel) {
      const history = input.history ?? [];
      const ticketText = `${input.subject}\n${input.description}`;
      const securityFlags = detectInjection([ticketText, ...history.map((h) => h.body)].join("\n"));
      const firstName = greetingName(input.authorContext);
      const policy = selectPolicy(input, category, ticketText, retriever, limits);
      const policyIds = policy.map((c) => c.id);

      const fallback = (reason: AiErrorCode, groundingIssues: GroundingIssue[] = [], spent: UsageRecord | null = null): ResponseDraft => {
        options.logger?.warn("ai.drafter.fallback", { reason });
        const f = fallbackDraft(category, firstName);
        return {
          draft: f.draft, citations: f.citations, retrievedChunkIds: policyIds.length > 0 ? policyIds : f.citations,
          source: "fallback", fallbackReason: reason, groundingIssues, securityFlags, usage: spent
        };
      };

      if (skipModel) return fallback(skipModel);

      const bookFacts = pickDraftBookFacts(input.bookContext);
      const example = retriever.retrieve({ text: ticketText, category, kinds: ["example"], maxChunks: 1, maxChars: 700 })[0];
      const prompt = buildDrafterPrompt({
        category, priority, subject: input.subject, description: input.description, history, bookFacts, policy,
        tone: TONE.content, example: example?.content, limits
      });

      let completion;
      try {
        completion = await options.provider.complete({ purpose: "draft", system: prompt.system, user: prompt.user, maxOutputTokens: limits.maxOutputTokens, temperature: 0.2 });
      } catch (error) {
        return fallback(error instanceof AiUnavailableError ? error.code : "AI_PROVIDER_ERROR");
      }

      let parsed;
      try { parsed = parseModelDraft(completion.content); } catch { return fallback("AI_INVALID_OUTPUT", [], completion.usage); }
      if (parsed.citations.some((id) => !policyIds.includes(id))) return fallback("AI_UNGROUNDED_OUTPUT", [], completion.usage);

      const text = parsed.draft.replace(GREETING_PLACEHOLDER, firstName);
      // The greeting name is author data we supplied, so it must not trip the checks; everything else must be grounded.
      const sources = [
        { text: ticketText }, ...history.map((h) => ({ text: h.body })), { text: JSON.stringify(bookFacts) },
        ...policy.map((c) => ({ text: c.content })),
        // The only response timeline the source documents give for a reported issue: ISBN errors get a 48-hour timeline.
        ...(category === "ISBN_METADATA" ? [{ text: ISBN_ESCALATION_TIMELINE }] : [])
      ];
      const issues = findUnsupportedClaims(parsed.draft.replace(GREETING_PLACEHOLDER, ""), sources, { strict: true });
      if (issues.length > 0) return fallback("AI_UNGROUNDED_OUTPUT", issues, completion.usage);

      // Every draft carries at least one citation: the model's, else the category's own policy chunk (the top-ranked one).
      const primary = policy.find((c) => c.categories.includes(category))?.id ?? policyIds[0];
      const citations = parsed.citations.length > 0 ? [...new Set(parsed.citations)] : primary ? [primary] : [];
      return {
        draft: text, citations, retrievedChunkIds: policyIds, source: "model", groundingIssues: [], securityFlags, usage: completion.usage
      };
    }
  };
}

function selectPolicy(input: DraftTicketInput, category: TicketCategory, text: string, retriever: KnowledgeRetriever, limits: DrafterLimits): RetrievedChunk[] {
  if (input.knowledge && input.knowledge.length > 0) {
    const out: RetrievedChunk[] = [];
    let used = 0;
    for (const k of input.knowledge) {
      if (out.length >= limits.maxPolicyChunks || used + k.content.length > limits.maxPolicyChars) continue;
      used += k.content.length;
      out.push({ id: k.id, topic: k.topic, content: k.content, categories: [category], kind: "policy", score: 0 });
    }
    if (out.length > 0) return out;
  }
  // Category boost guarantees the category's own policy is first; keywords may add one supporting chunk.
  return retriever.retrieve({ text, category, kinds: ["policy", "overview"], maxChunks: limits.maxPolicyChunks, maxChars: limits.maxPolicyChars });
}
