import { maxPriority, ticketCategories, type TicketCategory, type TicketPriority } from "../categories.js";

/**
 * Deterministic, model-free classification. Used (a) as the safe fallback when OpenRouter is unavailable or returns
 * invalid output and (b) to apply policy-derived priority floors to model output. It never produces prose claims.
 */

const CATEGORY_TERMS: Record<TicketCategory, readonly RegExp[]> = {
  ROYALTY_PAYMENTS: [/royalt/, /payout/, /\bpaid\b|\bpayment/, /bank (account|transfer|detail)/, /\bearnings?\b/, /net profit/, /quarter/, /\bsold \d+ copies/, /रॉयल्टी|भुगतान|\bbhugtan\b|\bpaisa\b|\bpaise\b/],
  ISBN_METADATA: [/\bisbn\b/, /metadata/, /imprint/, /\bbarcode/, /book description|description of my book/, /wrong book/, /आईएसबीएन/],
  PRINTING_QUALITY: [/print(ing)? quality|quality of (the )?print/, /misprint/, /binding/, /blurry|misaligned|faded|smudg/, /colou?r/, /reprint/, /defect|damaged|torn/, /author copies/, /प्रिंट|छपाई/],
  DISTRIBUTION_AVAILABILITY: [/unavailable|out of stock/, /\bamazon\b|\bflipkart\b/, /not (showing|listed|available)/, /listing|listed/, /\bbookleaf store\b/, /\bsync/, /उपलब्ध नहीं|अमेज़न/],
  BOOK_STATUS_PRODUCTION: [/typesetting|proofread|proofs?\b/, /cover design/, /\bproduction\b/, /\bmanuscript/, /book status|status of my book/, /when will (it|my book)/, /\bediting\b/, /कब तक|प्रकाशित/],
  GENERAL_INQUIRY: []
};

const ISBN_ERROR = /आईएसबीएन.{0,40}(गलत|अलग|डुप्लिकेट)|(गलत|अलग|डुप्लिकेट).{0,40}आईएसबीएन|(duplicate|different|wrong|incorrect|mismatch|doesn'?t match|not matching|another book).{0,60}\bisbn\b|\bisbn\b.{0,80}(duplicate|different|wrong|incorrect|mismatch|doesn'?t match|not matching|another book|error)/;

export function scoreCategories(text: string): Array<{ category: TicketCategory; score: number }> {
  const t = text.toLowerCase();
  return ticketCategories
    .map((category) => ({ category, score: CATEGORY_TERMS[category].filter((re) => re.test(t)).length }))
    .sort((a, b) => b.score - a.score);
}

function monthsMentioned(t: string): number {
  const m = /(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+(?:full\s+)?months?/.exec(t);
  if (!m?.[1]) return 0;
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
  return Number(m[1]) || words[m[1]] || 0;
}

export function heuristicClassify(text: string): { category: TicketCategory; priority: TicketPriority; matched: boolean; /** two categories matched equally well */ ambiguous: boolean } {
  const t = text.toLowerCase();
  const [top, second] = scoreCategories(t);
  // ISBN errors outrank loose royalty/distribution mentions ("ISBN on Amazon").
  const category: TicketCategory = ISBN_ERROR.test(t) ? "ISBN_METADATA" : top && top.score > 0 ? top.category : "GENERAL_INQUIRY";
  return { category, priority: policyPriority(category, t), matched: category !== "GENERAL_INQUIRY", ambiguous: category !== "ISBN_METADATA" && !!top && top.score > 0 && top.score === second?.score };
}

const LEGAL_OR_FRAUD = /\b(lawyer|legal action|legal notice|sue\b|court|fraud|scam|cheat(ed|ing)|consumer forum|police)\b/;
const NOT_RECEIVED = /(नहीं मिल|nahi mil|nahin mil)|(haven'?t|have not|never|not|yet to|didn'?t|did not)\s+(yet\s+)?(received|get|got|paid)|no (royalt|payment|payout)|still (waiting|pending|unpaid)|unpaid|overdue|missing (royalt|payment)/;

/** Priority from content signals, used as the heuristic answer and as a floor beneath model output. */
export function policyPriority(category: TicketCategory, lowerText: string): TicketPriority {
  const t = lowerText;
  let priority: TicketPriority = category === "GENERAL_INQUIRY" ? "LOW" : "MEDIUM";
  if (LEGAL_OR_FRAUD.test(t)) priority = "CRITICAL";
  switch (category) {
    case "ROYALTY_PAYMENTS":
      if (NOT_RECEIVED.test(t)) priority = maxPriority(priority, monthsMentioned(t) >= 3 ? "CRITICAL" : "HIGH");
      break;
    case "ISBN_METADATA":
      // Policy: reported ISBN errors (duplicate, wrong book linked) are high priority.
      if (ISBN_ERROR.test(t)) priority = maxPriority(priority, "HIGH");
      break;
    case "PRINTING_QUALITY":
      if (/misprint|binding|blurry|misaligned|defect|damaged|terrible|faded|खराब/.test(t)) priority = maxPriority(priority, "HIGH");
      break;
    case "DISTRIBUTION_AVAILABILITY":
      if (/unavailable|out of stock|not (showing|available)/.test(t)) priority = maxPriority(priority, "MEDIUM");
      break;
    default:
      break;
  }
  return priority;
}

/** Floor applied to model output; only raises, never lowers, and only for rules grounded in BookLeaf policy or legal/fraud language. */
export function priorityFloor(category: TicketCategory, text: string): TicketPriority {
  const t = text.toLowerCase();
  let floor: TicketPriority = "LOW";
  if (LEGAL_OR_FRAUD.test(t)) floor = "CRITICAL";
  if (category === "ISBN_METADATA" && ISBN_ERROR.test(t)) floor = maxPriority(floor, "HIGH");
  return floor;
}
