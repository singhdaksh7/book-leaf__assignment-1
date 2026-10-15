import type { UsageRecord } from "../usage.js";

export interface LlmRequest {
  /** Stable label for usage tracking, e.g. "classify". */
  purpose: string;
  system: string;
  user: string;
  maxOutputTokens?: number;
  temperature?: number;
}
export interface LlmResponse { content: string; usage: UsageRecord; }

/** Provider boundary. Implementations throw AiUnavailableError only; messages must be safe to store. */
export interface LlmProvider { complete(request: LlmRequest): Promise<LlmResponse>; }
