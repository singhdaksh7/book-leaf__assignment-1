import { z } from "zod";
import { ticketCategories, ticketPriorities } from "../categories.js";
import { AiUnavailableError } from "../errors.js";

/** Strict: unknown keys (e.g. injected "sendReply") and out-of-enum values are rejected, not stripped. */
export const modelClassificationSchema = z.object({
  category: z.enum(ticketCategories),
  priority: z.enum(ticketPriorities),
  confidence: z.number().min(0).max(1),
  rationale: z.string().trim().min(1).max(400),
  citations: z.array(z.string().min(1).max(100)).max(6)
}).strict();
export type ModelClassification = z.infer<typeof modelClassificationSchema>;

/** Models sometimes wrap JSON in prose or code fences; accept only a single top-level object. */
const MAX_OUTPUT_CHARS = 20_000;

export function extractJsonObject(raw: string): unknown {
  if (raw.length > MAX_OUTPUT_CHARS) throw new AiUnavailableError("AI returned oversized output", "AI_INVALID_OUTPUT");
  const trimmed = raw.trim();
  const candidates = [trimmed];
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  if (fenced?.[1]) candidates.push(fenced[1]);
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  // Prose-wrapped JSON only; a top-level array must not have an inner object extracted from it.
  if (!trimmed.startsWith("[") && first !== -1 && last > first) candidates.push(trimmed.slice(first, last + 1));
  for (const c of candidates) {
    try {
      const parsed: unknown = JSON.parse(c);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch { /* try next candidate */ }
  }
  throw new AiUnavailableError("AI returned output that is not a JSON object", "AI_INVALID_OUTPUT");
}

export function parseModelClassification(raw: string): ModelClassification {
  const result = modelClassificationSchema.safeParse(extractJsonObject(raw));
  if (!result.success) throw new AiUnavailableError("AI output failed schema validation", "AI_INVALID_OUTPUT");
  return result.data;
}
