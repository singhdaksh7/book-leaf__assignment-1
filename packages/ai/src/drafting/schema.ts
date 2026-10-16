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

export function parseModelDraft(raw: string): ModelDraft {
  const result = modelDraftSchema.safeParse(extractJsonObject(raw));
  if (!result.success) throw new AiUnavailableError("AI draft failed schema validation", "AI_INVALID_OUTPUT");
  // Real models often write a generic "Dear Author," instead of the placeholder. Only a generic salutation (never a personal name) is
  // normalised; the real first name is substituted after validation. Anything else, including "Dear John,", is still rejected.
  const draft = result.data.draft.replace(/^Dear (?:Valued )?(?:Author|Writer),/i, `Dear ${GREETING_PLACEHOLDER},`);
  // Exactly one greeting placeholder at the start; no other template braces.
  const stripped = draft.replace(GREETING_PLACEHOLDER, "");
  if (!draft.startsWith(`Dear ${GREETING_PLACEHOLDER},`) || stripped.includes("{{")) {
    throw new AiUnavailableError("AI draft did not follow the required greeting format", "AI_INVALID_OUTPUT");
  }
  return { ...result.data, draft };
}
