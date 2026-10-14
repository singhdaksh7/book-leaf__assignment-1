export interface UsageRecord {
  purpose: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Provider-reported cost in USD, or null when the provider did not report one. */
  costUsd: number | null;
  /** Provider HTTP calls made for this completion, including retries and fallback. */
  attempts: number;
  fallbackUsed: boolean;
  latencyMs: number;
}

export interface UsageSummary {
  calls: number; promptTokens: number; completionTokens: number; totalTokens: number; costUsd: number; costUnknownCalls: number;
}

/** In-memory aggregate for server-side metrics; contains no prompts or author data. */
export class UsageTracker {
  readonly #records: UsageRecord[] = [];
  record(r: UsageRecord): void { this.#records.push(r); }
  records(): readonly UsageRecord[] { return this.#records; }
  summary(): UsageSummary {
    const s: UsageSummary = { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0, costUnknownCalls: 0 };
    for (const r of this.#records) {
      s.calls += 1; s.promptTokens += r.promptTokens; s.completionTokens += r.completionTokens; s.totalTokens += r.totalTokens;
      if (r.costUsd === null) s.costUnknownCalls += 1; else s.costUsd += r.costUsd;
    }
    return s;
  }
}

/** Minimal logger; implementations must only receive codes/counters, never prompts, bodies or secrets. */
export interface AiLogger { warn(event: string, meta?: Record<string, string | number | boolean>): void; }
