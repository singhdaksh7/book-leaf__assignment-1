import type { TicketCategory } from "../categories.js";
import { KB_CHUNKS, type ChunkKind, type KbChunk } from "./chunks.js";

export interface RetrievalQuery {
  /** Untrusted ticket text; only used for keyword matching, never executed or interpolated. */
  text: string;
  /** Boosts chunks for this category (e.g. once classified, for drafting). */
  category?: TicketCategory;
  maxChunks?: number;
  /** Total character budget of returned chunk content: the main prompt-cost lever. */
  maxChars?: number;
  kinds?: readonly ChunkKind[];
}
export interface RetrievedChunk { id: string; topic: string; content: string; categories: readonly TicketCategory[]; kind: ChunkKind; score: number; }

/** Retrieval boundary: swap for embeddings later without touching callers. */
export interface KnowledgeRetriever { retrieve(query: RetrievalQuery): RetrievedChunk[]; }

const DEFAULT_MAX_CHUNKS = 3;
const DEFAULT_MAX_CHARS = 2400;
const CATEGORY_BOOST = 3;

const normalize = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ");

/** Deterministic keyword retriever over the built-in BookLeaf knowledge base. No network, no embeddings cost. */
export class KeywordKnowledgeRetriever implements KnowledgeRetriever {
  readonly #chunks: readonly KbChunk[];
  constructor(chunks: readonly KbChunk[] = KB_CHUNKS) { this.#chunks = chunks; }

  retrieve(query: RetrievalQuery): RetrievedChunk[] {
    const maxChunks = query.maxChunks ?? DEFAULT_MAX_CHUNKS;
    const maxChars = query.maxChars ?? DEFAULT_MAX_CHARS;
    const kinds = query.kinds ?? ["policy"];
    const text = normalize(query.text);

    const scored = this.#chunks
      .filter((c) => kinds.includes(c.kind))
      .map((c) => {
        let score = 0;
        for (const kw of c.keywords) if (text.includes(kw)) score += 1;
        if (query.category && c.categories.includes(query.category)) score += CATEGORY_BOOST;
        return { chunk: c, score };
      })
      .filter((s) => s.score > 0)
      // Stable order for equal scores (declaration order) keeps prompts deterministic and cache-friendly.
      .sort((a, b) => b.score - a.score);

    const picked: RetrievedChunk[] = [];
    let used = 0;
    for (const { chunk, score } of scored) {
      if (picked.length >= maxChunks) break;
      if (used + chunk.content.length > maxChars) continue;
      used += chunk.content.length;
      picked.push({ id: chunk.id, topic: chunk.topic, content: chunk.content, categories: chunk.categories, kind: chunk.kind, score });
    }
    if (picked.length === 0 && kinds.includes("overview")) {
      const overview = this.#chunks.find((c) => c.kind === "overview");
      if (overview) picked.push({ id: overview.id, topic: overview.topic, content: overview.content, categories: overview.categories, kind: overview.kind, score: 0 });
    }
    return picked;
  }
}

export function createKnowledgeRetriever(): KnowledgeRetriever { return new KeywordKnowledgeRetriever(); }
