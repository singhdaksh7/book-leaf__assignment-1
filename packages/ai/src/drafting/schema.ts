import { z } from "zod";
import { AiUnavailableError } from "../errors.js";
import { extractJsonObject } from "../classifier/schema.js";

/** Greeting placeholder the model must use; swapped for the real first name (or "Author") after validation, so names never reach the provider. */
export const GREETING_PLACEHOLDER = "{{authorFirstName}}";

export const modelDraftSchema = z.object({
  draft: z.string().trim().min(40).max(2_500),
  citations: z.array(z.string().min(1).max(100)).max(6)
}).strict();
export type ModelDraft = z.infer<typeof modelDraftSchema>;

const TRAILING_CITATIONS = /\n+[ \t]*(?:Citations?[ \t]*:[^\n]*|\{\s*"citations"\s*:\s*\[[^\]]*\]\s*\})\s*$/i;
const KB_ID = /kb\.[\w.-]+/g;

/** Models often append "Citations: [kb.x]" to the reply text; citations belong in the array, not in author-facing text. */
function splitTrailingCitations(text: string): { body: string; ids: string[] } {
  const m = TRAILING_CITATIONS.exec(text);
  if (!m) return { body: text, ids: [] };
  return { body: text.slice(0, m.index).trimEnd(), ids: m[0].match(KB_ID) ?? [] };
}

/**
 * Some free models ignore JSON mode and answer with the reply text itself. That is accepted only when it begins with the exact
 * greeting; it then goes through the same schema, citation, grounding and strict-claim checks as a JSON answer.
 */
function salvagePlainText(raw: string): unknown {
  const trimmed = raw.trim();
  if (!/^Dear (?:Valued )?(?:Author|Writer|\{\{authorFirstName\}\}),/i.test(trimmed)) return undefined;
  const { body, ids } = splitTrailingCitations(trimmed);
  return { draft: body, citations: [...new Set(ids)] };
}

function withoutTrailingCitations(candidate: unknown): unknown {
  if (!candidate || typeof candidate !== "object") return candidate;
  const c = candidate as { draft?: unknown; citations?: unknown };
  if (typeof c.draft !== "string") return candidate;
  const { body, ids } = splitTrailingCitations(c.draft);
  // A missing or malformed citations field stays invalid (the schema rejects it); only a real array is merged.
  if (!Array.isArray(c.citations)) return candidate;
  const existing = c.citations as unknown[];
  return { ...c, draft: body, citations: [...new Set([...existing, ...ids])] };
}

export function parseModelDraft(raw: string): ModelDraft {
  let candidate: unknown;
  try { candidate = extractJsonObject(raw); } catch (error) {
    candidate = salvagePlainText(raw);
    if (candidate === undefined) throw error;
  }
  // A stray {"citations": [...]} fragment after plain text parses as an object with no draft: treat that as plain text too.
  if (candidate && typeof candidate === "object" && typeof (candidate as { draft?: unknown }).draft !== "string") candidate = salvagePlainText(raw) ?? candidate;
  const result = modelDraftSchema.safeParse(withoutTrailingCitations(candidate));
  if (!result.success) throw new AiUnavailableError("AI draft failed schema validation", "AI_INVALID_OUTPUT");
  // Real models often write a generic "Dear Author," instead of the placeholder. Only a generic salutation (never a personal name) is
  // normalised; the real first name is substituted after validation. Anything else, including "Dear John,", is still rejected.
  const draft = result.data.draft.replace(/^Dear (?:Valued )?(?:Author|Writer),/i, `Dear ${GREETING_PLACEHOLDER},`);
  // Exactly one greeting placeholder at the start; no other template braces.
  const stripped = draft.replace(GREETING_PLACEHOLDER, "");
  // No leftover JSON or citation bookkeeping may reach the admin-facing draft.
  if (!draft.startsWith(`Dear ${GREETING_PLACEHOLDER},`) || stripped.includes("{{") || /"citations"|\{\s*"/i.test(stripped)) {
    throw new AiUnavailableError("AI draft did not follow the required greeting format", "AI_INVALID_OUTPUT");
  }
  return { ...result.data, draft };
}
