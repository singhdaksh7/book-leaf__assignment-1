import { randomBytes } from "node:crypto";

// Zero-width / bidi control characters are used to hide or reorder injected instructions.
const INVISIBLE = /[​-‏‪-‮⁠-⁩؜᠎﻿]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// Digit runs (optionally separated) that look like phone, bank-account or card numbers.
const LONG_NUMBER = /\+?\d[\d\s().-]{7,}\d/g;

/**
 * Removes contact details and account-like numbers an author may have typed into a ticket, so they never reach the
 * provider. Keeps ISBN-13s (needed to understand ISBN reports), dates and ordinary money amounts.
 */
export function redactPii(text: string): string {
  return text.replace(EMAIL, "[email]").replace(LONG_NUMBER, (match) => {
    const digits = match.replace(/\D/g, "");
    if (/^97[89]\d{10}$/.test(digits)) return match;
    if (/^\d{4}-\d{2}-\d{2}$/.test(match.trim())) return match;
    return digits.length >= 9 ? "[number]" : match;
  });
}

/**
 * Cleans untrusted text (ticket body, history, attachment names/text) before it enters a prompt:
 * removes control/invisible characters, defuses angle brackets so the text cannot close or forge a prompt
 * boundary tag, collapses whitespace runs and enforces a hard length cap (a cost control as well).
 */
export function sanitizeUntrusted(text: string, maxChars: number): string {
  const cleaned = text
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(CONTROL, "")
    .replace(/</g, "‹")
    .replace(/>/g, "›")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return truncate(redactPii(cleaned), maxChars);
}

function truncate(cleaned: string, maxChars: number): string {
  return cleaned.length <= maxChars ? cleaned : `${cleaned.slice(0, maxChars).trimEnd()} …[truncated]`;
}

const INJECTION_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["override-instructions", /\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|any|your|system|these)\b[^.\n]{0,30}\b(instruction|prompt|rule|guideline|polic)/i],
  ["role-reassignment", /\b(you are now|act as|pretend (to be|you are)|from now on you|new instructions?:|developer mode|jailbreak|DAN mode)\b/i],
  ["prompt-exfiltration", /\b(reveal|show|print|repeat|output|leak)\b[^.\n]{0,30}\b(system prompt|your prompt|instructions|api[ -]?key|secret|credentials?)\b/i],
  ["forced-output", /\b(set|mark|classify|label|rate)\b[^.\n]{0,30}\b(priority|category)\b[^.\n]{0,20}\b(as|to)\b[^.\n]{0,12}\b(critical|high|low|medium)\b/i],
  ["fake-boundary", /(<\/?\s*(system|assistant|untrusted|ticket)[^>]*>|\[\/?(INST|SYSTEM)\]|###\s*(system|instruction))/i],
  ["auto-send", /\b(send|reply|respond|email|publish|post)\b[^.\n]{0,50}\b(automatically|without (?:any )?(?:admin |human |manual )?(?:review|approval|checking)|skip(?:ping)? (?:the )?review|bypass(?:ing)? (?:the )?(?:review|admin))/i],
  ["fabricated-action", /\b(tell|say|write|state)\b[^.\n]{0,30}\b(refund(ed)?|paid|payout|transferred|approved)\b/i]
];

/** Returns the labels of injection heuristics that matched. A signal for admins/logs, never a gate: attacks are neutralised structurally. */
export function detectInjection(text: string): string[] {
  const probe = text.normalize("NFKC").replace(INVISIBLE, "");
  return INJECTION_PATTERNS.filter(([, re]) => re.test(probe)).map(([label]) => label);
}

export interface UntrustedBlock { open: string; close: string; wrap(label: string, body: string): string; }

/** Per-call random boundary so attacker text cannot guess and terminate it. */
export function createUntrustedBlock(nonce: string = randomBytes(8).toString("hex")): UntrustedBlock {
  return {
    open: `<untrusted-${nonce}>`,
    close: `</untrusted-${nonce}>`,
    wrap(label: string, body: string) { return `[${label}]\n<untrusted-${nonce}>\n${body}\n</untrusted-${nonce}>`; }
  };
}
