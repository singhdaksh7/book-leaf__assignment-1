import { findUnsafeMarkup, strictIssues } from "./grounding-strict.js";
export interface GroundingSource { text: string; }

export type GroundingIssueKind =
  | "ungrounded-number" | "ungrounded-date" | "completed-action"
  // strict (author-facing drafts) only:
  | "payout-promise" | "unsupported-link" | "unsupported-commitment" | "unsupported-timeline" | "unsupported-markup" | "unsupported-feature";

export interface GroundingOptions {
  /** Author-facing drafts: also reject payout promises, links/contact details and refund/compensation commitments. */
  strict?: boolean;
}
export interface GroundingIssue { kind: GroundingIssueKind; detail: string; }

export const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DATE_PATTERNS: RegExp[] = [
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g,
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})\\b(?:,?\\s+\\d{4})?`, "gi"),
  new RegExp(`\\b(?:${MONTHS})\\s+\\d{1,2}(?:st|nd|rd|th)?\\b(?:,?\\s+\\d{4})?`, "gi")
];
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

const ACTION_VERBS = "issued|processed|refunded|credited|paid|transferred|dispatched|shipped|reprinted|resolved|fixed|triggered|initiated|escalated|re-?synced|corrected|updated|approved|sent";
// Past/perfect-tense claims that something was already done. Future commitments ("we will escalate") do not match.
const COMPLETED_ACTION_PATTERNS: RegExp[] = [
  new RegExp(`\\b(?:i|we)(?:'ve| have)?\\s+(?:already\\s+)?(?:${ACTION_VERBS})\\b`, "i"),
  new RegExp(`\\b(?:has|have|had)\\s+(?:already\\s+|now\\s+|just\\s+)?been\\s+(?:${ACTION_VERBS})\\b`, "i"),
  // "our team has escalated", "BookLeaf has processed"
  new RegExp(`\\b(?:team|bookleaf|support|production|finance)\\s+(?:has|have|had)\\s+(?:already\\s+|now\\s+|just\\s+)?(?:${ACTION_VERBS})\\b`, "i"),
  /\b(?:is|are)\s+(?:now\s+|already\s+)?(?:fixed|resolved|corrected|back (?:online|live)|live again)\b/i,
  new RegExp(`\\balready\\s+(?:${ACTION_VERBS})\\b`, "i"),
  new RegExp(`\\b(?:was|were)\\s+(?:successfully\\s+)?(?:${ACTION_VERBS})\\b`, "i")
];

const normNumber = (n: string) => n.replace(/,/g, "").replace(/\.0+$/, "");
const normDate = (d: string) => d.toLowerCase().replace(/(\d)(?:st|nd|rd|th)\b/g, "$1").replace(/[,\s]+/g, " ").trim();

function numbersIn(text: string): Set<string> {
  return new Set((text.match(NUMBER) ?? []).map(normNumber));
}
export function datesIn(text: string): string[] {
  return DATE_PATTERNS.flatMap((re) => text.match(re) ?? []);
}

/**
 * Deterministic guard against fabricated specifics. Every number and date in `output` must literally appear in
 * `sources` (ticket text, supplied book facts, retrieved policy), and the output must not claim actions already taken.
 * Schema validation cannot prove grounding; this is the cheap, model-free check applied to all generated text.
 */
export function findUnsupportedClaims(output: string, sources: readonly GroundingSource[], options: GroundingOptions = {}): GroundingIssue[] {
  const corpus = sources.map((s) => s.text).join("\n");
  // Date components must not make loose numbers "grounded" (the 15 in 2025-12-15 does not support "15%").
  let corpusNoDates = corpus;
  for (const d of datesIn(corpus)) corpusNoDates = corpusNoDates.replace(d, " ");
  const allowedNumbers = numbersIn(corpusNoDates);
  const allowedDates = new Set(datesIn(corpus).map(normDate));
  const issues: GroundingIssue[] = [];

  const outputDates = datesIn(output);
  for (const d of outputDates) {
    if (!allowedDates.has(normDate(d))) issues.push({ kind: "ungrounded-date", detail: d });
  }
  // Numbers inside an already-checked date are covered by that check.
  let remainder = output;
  for (const d of outputDates) remainder = remainder.replace(d, " ");
  for (const n of new Set(remainder.match(NUMBER) ?? [])) {
    if (!allowedNumbers.has(normNumber(n))) issues.push({ kind: "ungrounded-number", detail: n });
  }
  for (const re of COMPLETED_ACTION_PATTERNS) {
    const m = re.exec(output);
    if (m) issues.push({ kind: "completed-action", detail: m[0] });
  }
  if (options.strict) issues.push(...strictIssues(output, corpus), ...findUnsafeMarkup(output));
  return issues;
}
