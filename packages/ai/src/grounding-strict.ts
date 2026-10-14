import { datesIn, type GroundingIssue } from "./grounding.js";

const LINK = /\bhttps?:\/\/\S+|\bwww\.\S+|\b[\w.+-]+@[\w-]+\.[\w.-]+\b|\b\w+\.(?:com|in|org|net|io|co)\b/i;
const COMMITMENT = /\b(?:refund|reimburs|compensat|waive|credit note|discount)\w*/i;
const PAYOUT_WORDS = /\b(?:payout|payment|royalt\w*|transfer\w*)/i;
const CURRENCY = /[₹$]\s?\d|\b(?:rs\.?|inr)\s?\d/i;

/**
 * Extra checks for author-facing drafts. BookLeaf policy offers a free reprint after verification, but no refunds
 * or compensation, and a payout date can never be promised by a model: only the team can confirm it.
 */
export function strictIssues(output: string): GroundingIssue[] {
  const issues: GroundingIssue[] = [];
  const link = LINK.exec(output);
  if (link) issues.push({ kind: "unsupported-link", detail: link[0] });
  const commitment = COMMITMENT.exec(output);
  if (commitment) issues.push({ kind: "unsupported-commitment", detail: commitment[0] });
  for (const sentence of output.split(/(?<=[.!?])\s+|\n+/)) {
    if (!PAYOUT_WORDS.test(sentence)) continue;
    const dated = datesIn(sentence).length > 0 && /\b(?:will|shall|expect\w*|by)\b/i.test(sentence);
    const guaranteed = /\b(?:guarantee[ds]?|promise[ds]?)\b/i.test(sentence);
    const amountPromised = CURRENCY.test(sentence)
      && /\bwill\s+(?:be\s+)?(?:paid|credited|transferred|received|sent|arrive|reach)\b/i.test(sentence);
    if (dated || guaranteed || amountPromised) issues.push({ kind: "payout-promise", detail: sentence.trim().slice(0, 80) });
  }
  return issues;
}
