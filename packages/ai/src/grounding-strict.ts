import { datesIn, type GroundingIssue } from "./grounding.js";

const LINK = /\bhttps?:\/\/\S+|\bwww\.\S+|\b[\w.+-]+@[\w-]+\.[\w.-]+\b|\b\w+\.(?:com|in|org|net|io|co)\b/i;
// BookLeaf policy offers a free reprint after verification. It offers no refunds, compensation, credits or guarantees.
const COMMITMENT = /\b(?:refund|reimburs|compensat|waive|credit note|discount|cashback|voucher|money[- ]back|goodwill|complimentary|guarantee[ds]?|promise[ds]?)\w*|\bfree (?:copies|books|shipping|upgrade|marketing)\b/i;
// A quoted menu/section/tab label ("the 'Author Profile' section", "go to 'Settings'") is a product claim. It must appear in the sources
// or the ticket, otherwise the model invented a UI feature. "your dashboard" (unquoted) is unaffected.
const UI_LABEL = /['‘"“]([A-Z][A-Za-z &-]{2,40})['’"”]\s+(?:section|tab|page|menu|button|option|screen|link)\b|\b(?:section|tab|page|menu|button|option|screen)\s+(?:called|named|labell?ed|titled)\s+['‘"“]?([A-Z][A-Za-z &-]{2,40})|\b(?:navigate to|go to|open|click|select|choose|visit)\s+(?:the\s+)?['‘"“]([A-Z][A-Za-z &-]{2,40})['’"”]/g;
// The portal sends no e-mail, so a draft must not tell the author to reply to one.
const REPLY_EMAIL = /\b(?:reply|respond) to this e-?mail\b/i;
const PAYOUT_WORDS = /\b(?:payout|payment|royalt\w*|transfer\w*)/i;
const CURRENCY = /[₹$]\s?\d|\b(?:rs\.?|inr)\s?\d/i;
const PAYOUT_FUTURE = /\byou(?:'ll| will)\s+(?:receive|get|be paid)\b|\bwill\s+(?:be\s+)?(?:paid|credited|transferred|processed|released|disbursed|sent|arrive|reach)\b/i;
// "If royalties are due ..." states a condition. Only an unconditional "is scheduled / due / on its way" is a payout promise.
const PAYOUT_DUE = /\b(?:is|are)\s+(?:scheduled|due|on (?:its|the) way)\b/i;
const CONDITIONAL_LEAD = /\b(?:if|whether|when|once|unless|until)\b[^.!?;]*$/i;
const payoutDue = (sentence: string): boolean => {
  const m = PAYOUT_DUE.exec(sentence);
  return !!m && !CONDITIONAL_LEAD.test(sentence.slice(0, m.index));
};

// "N unit" / "N–M unit" / "48-hour". Business-day wording is ignored so "5–7 business days" equals "5–7 days".
const DURATION = /(\d+)(?:\s*[–-]\s*(\d+))?[\s-]*(?:business[\s-]+)?(hour|day|week|month|quarter)s?\b/gi;
// Spelled-out or relative time frames that digit checks cannot see.
const WORD_TIMEFRAME = /\b(?:(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|few|couple of|several|next)\s+(?:business\s+)?(?:hour|day|week|month|quarter)s?|tomorrow|tonight|same[- ]day|(?:by\s+)?(?:the\s+)?end of (?:the\s+)?(?:day|week|month)|by\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/gi;

function durationKeys(text: string): Set<string> {
  const keys = new Set<string>();
  for (const m of text.matchAll(DURATION)) keys.add(`${m[1]}${m[2] ? `-${m[2]}` : ""}|${(m[3] ?? "").toLowerCase()}`);
  return keys;
}

/**
 * Extra checks for author-facing drafts. A time frame is only allowed if the same number/range and unit appear in the
 * sources (so "within 7 days" is rejected even though "7" occurs in "5–7 business days"), and spelled-out or relative
 * time frames are rejected unless the author or policy used the same words.
 */
export function strictIssues(output: string, corpus: string, timelineCorpus: string = corpus): GroundingIssue[] {
  const issues: GroundingIssue[] = [];
  const link = LINK.exec(output);
  if (link) issues.push({ kind: "unsupported-link", detail: link[0] });
  const commitment = COMMITMENT.exec(output);
  if (commitment) issues.push({ kind: "unsupported-commitment", detail: commitment[0] });
  const corpusLower = corpus.toLowerCase();
  for (const m of output.matchAll(UI_LABEL)) {
    const label = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (label && !corpusLower.includes(label.toLowerCase())) issues.push({ kind: "unsupported-feature", detail: label });
  }
  const email = REPLY_EMAIL.exec(output);
  if (email) issues.push({ kind: "unsupported-feature", detail: email[0] });

  const allowedDurations = durationKeys(timelineCorpus);
  for (const key of durationKeys(output)) {
    if (!allowedDurations.has(key)) issues.push({ kind: "unsupported-timeline", detail: key.replace("|", " ") });
  }
  const lowerCorpus = timelineCorpus.toLowerCase();
  for (const m of output.matchAll(WORD_TIMEFRAME)) {
    if (!lowerCorpus.includes(m[0].toLowerCase())) issues.push({ kind: "unsupported-timeline", detail: m[0] });
  }

  for (const sentence of output.split(/(?<=[.!?])\s+|\n+/)) {
    // An amount promised for payment is a promise whether or not the sentence says "payout" or "royalty".
    if (CURRENCY.test(sentence) && /\bwill\s+(?:be\s+)?(?:paid|credited|transferred|received|sent|arrive|reach|deposited)\b/i.test(sentence)) {
      issues.push({ kind: "payout-promise", detail: sentence.trim().slice(0, 80) });
      continue;
    }
    if (!PAYOUT_WORDS.test(sentence)) continue;
    const dated = datesIn(sentence).length > 0 && /\b(?:will|shall|expect\w*|by)\b/i.test(sentence);
    const amountPromised = CURRENCY.test(sentence) && /\bwill\s+(?:be\s+)?(?:paid|credited|transferred|received|sent|arrive|reach)\b/i.test(sentence);
    if (dated || amountPromised || PAYOUT_FUTURE.test(sentence) || payoutDue(sentence)) issues.push({ kind: "payout-promise", detail: sentence.trim().slice(0, 80) });
  }
  return issues;
}

/** Markup/links have no place in a plain-text reply or an admin rationale (rendering or email injection). */
export function findUnsafeMarkup(text: string): GroundingIssue[] {
  const m = /<[^>]{1,200}>|\]\(|javascript:|data:text|&#x?\d+;|\bon\w+\s*=/i.exec(text);
  const link = LINK.exec(text);
  return [...(m ? [{ kind: "unsupported-markup" as const, detail: m[0].slice(0, 40) }] : []), ...(link ? [{ kind: "unsupported-link" as const, detail: link[0] }] : [])];
}
