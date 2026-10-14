# @bookleaf/ai

Policy-grounded ticket analysis for the BookLeaf Author Support Portal: category, priority and a cited draft reply for **admin review**. Server-side only. No Express, Prisma or database imports. The package never sends a message, never changes ticket status, and makes no network call unless the backend invokes it.

## What it does

`analyzeTicket(input)` runs two bounded OpenRouter calls: **classify** into the six contract categories and four priorities, then **draft** an author reply from retrieved BookLeaf policy. Each step degrades to a deterministic result instead of throwing.

| Safeguard | Behaviour |
| --- | --- |
| Human review | Result is parsed through `aiAnalysisSchema`; `requiresHumanReview` is always `true`. Only an explicit admin reply action in the API may send anything. |
| Grounding | A draft is rejected if a number or date is not in the ticket, book facts or retrieved policy; it claims an action is already done; promises a payout; offers a refund/compensation; or contains a link/email. |
| Response times | The source documents give a **48-hour timeline only for reported ISBN errors** (the tone guideline's "48 hours" is an example). Drafts may state a time frame only if a retrieved policy states it (5–7 business days reprint, 7–10 business days listing, 24–48 hours re-sync) or the ticket is an ISBN error. Fallback drafts promise no time frame; they say the team will follow up. |
| Citations | Must be ids of retrieved policy chunks; unknown ids reject the output. If the model cites nothing, the category's own policy chunk is cited. |
| Injection | Ticket text, history and attachment text are sanitized and sent inside random-nonce `<untrusted-…>` blocks; output is strict-schema validated; attempts are reported in `meta.securityFlags` and cap confidence. |
| Privacy | Author name/phone/city/email and unrelated book fields never reach the model. The greeting placeholder is filled locally. Logs get codes and counters only. |
| Cost | ≤ 3 policy chunks (2,400 chars) classifying, ≤ 2 (1,800 chars) drafting, truncated text, 2 history messages, capped output tokens, static system prompts, bounded retries. Tokens and cost of rejected completions are still recorded. |

## Configuration (server environment)

See `.env.example`. Never expose these to `apps/web`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | none (required) | Missing/invalid → analyses use fallbacks with reason `AI_NOT_CONFIGURED`. |
| `OPENROUTER_MODEL` | `openai/gpt-4o-mini` | Primary model. |
| `OPENROUTER_FALLBACK_MODEL` | unset | Tried once, only after retryable failures of the primary. |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | https required (http for localhost only). |
| `OPENROUTER_APP_NAME`, `OPENROUTER_APP_URL` | name set, URL unset | Optional attribution headers. |
| `AI_TIMEOUT_MS` | `15000` | Per-attempt timeout (1,000–120,000). |
| `AI_MAX_RETRIES` | `2` | Extra attempts per model for 429/5xx/timeout/network (0–5). |
| `AI_RETRY_BASE_DELAY_MS` / `AI_RETRY_MAX_DELAY_MS` | `500` / `4000` | Exponential backoff with jitter; `Retry-After` honoured. |
| `AI_MAX_OUTPUT_TOKENS` | `400` | Ceiling on completion tokens per call. |

## Persistence mapping (`AiAnalysis`)

The helpers use the Prisma field names but plain types (`AiAnalysisRowData`). They are pure; the backend owns the client, transactions and `Prisma.DbNull`.

| `AiAnalysis` column | Source |
| --- | --- |
| `status` | `PENDING` on creation; `COMPLETED`/`FAILED` from `decideAttempt` |
| `promptVersion` | `PROMPT_VERSION` (`<KB_VERSION>/classify-v1/draft-v1`), required, written on every row including PENDING |
| `model` | distinct models used, comma-joined (≤ 120 chars); `null` when no completion was made |
| `category`, `priority`, `confidence`, `rationale`, `draftResponse` | `analysis.*`; all `null` unless COMPLETED |
| `citations` | `analysis.knowledgeBaseCitations` (string[], may be empty); `null` unless COMPLETED (write `Prisma.DbNull`) |
| `inputTokens`, `outputTokens` | sum of `promptTokens`/`completionTokens` over all completions, including rejected ones; `null` if none |
| `costMicrounits` | `round(costUsd × 1,000,000)`; **`null` when the provider reported no cost, never 0** |
| `errorCode` | `null` unless FAILED; then a sanitized `AiErrorCode` |
| `requiresHumanReview` | not stored; `serializeAttempt` injects literal `true` |

## Failure-state semantics

`meta.fallbackReasons` being non-empty does **not** mean FAILED. The rule (`decideAttempt`):

| Classification | Draft | Attempt state | Meaning |
| --- | --- | --- | --- |
| model | model | `COMPLETED` (`MODEL`) | normal |
| model | fallback | `COMPLETED` (`PARTIAL_FALLBACK`) | model category/priority; safe template draft because the draft call failed or the draft was rejected (ungrounded/invalid) |
| heuristic | model | `COMPLETED` (`PARTIAL_FALLBACK`) | keyword category/priority (confidence ≤ 0.3) with a validated model draft |
| heuristic | fallback | `FAILED` (`FULL_FALLBACK`) | no usable model output: provider down, not configured, or all output rejected |

For `FAILED`, `errorCode` is a transient reason if any occurred (so the attempt is retried), otherwise the first reason. `retry` advice:

| Codes | `retry` | Backend action |
| --- | --- | --- |
| `AI_TIMEOUT`, `AI_RATE_LIMITED`, `AI_PROVIDER_ERROR`, `AI_NETWORK_ERROR` | `later` | optional delayed retry (see below) |
| `AI_INVALID_OUTPUT`, `AI_UNGROUNDED_OUTPUT`, `AI_INTERNAL_ERROR` | `manual` | no automatic loop; admin "refresh" creates a new attempt |
| `AI_NOT_CONFIGURED` | `after-config` | retrying cannot help until configuration is fixed |
| `AI_RESULT_INVALID` | n/a | produced by `serializeAttempt` when a stored COMPLETED row is malformed; draft withheld |
| `AI_ATTEMPT_ABANDONED` | n/a | for a stale PENDING row the backend closes (below) |

A `FAILED` attempt exposes `analysis: null` over HTTP (shared contract). The deterministic analysis is still returned in `decision.fallbackAnalysis` for an optional admin-only "template suggestion"; it is not persisted as an AI result. To persist it as a low-confidence COMPLETED result instead, pass `{ fullFallbackAs: "COMPLETED" }` (a product decision for the owner). In every case the ticket stays open and the admin can classify and reply manually.

## Backend integration

```ts
import {
  createAiServiceFromEnv, UsageTracker, analyzeForPersistence, pendingRow, serializeAttempt, inputFingerprint, worstCaseAnalysisMs
} from "@bookleaf/ai";
import type { AnalyzeTicketInput } from "@bookleaf/ai";
import { Prisma } from "@bookleaf/db";

const ai = createAiServiceFromEnv(process.env, { usageTracker: new UsageTracker(), logger });   // never throws

// 1. Ticket creation commits first (never blocked by AI).
// 2. Background job (idempotency: see below):
async function runAnalysis(prisma, ticketId: string, input: AnalyzeTicketInput) {
  const attempt = await prisma.aiAnalysis.create({ data: { ticketId, ...dbNull(pendingRow()) } });   // visible PENDING
  const result = await analyzeForPersistence(ai, input);                                              // never throws
  await prisma.aiAnalysis.update({ where: { id: attempt.id }, data: dbNull(result.row) });           // state + result atomically
  // result.status === "FAILED" → result.errorCode / result.retry; do NOT change ticket status or create a message.
}
const dbNull = (row) => ({ ...row, citations: row.citations ?? Prisma.DbNull });

// 3. Reads: GET /admin/tickets/:id/ai-analysis → latest row → serializeAttempt(row) (validates invariants, drops internals)
```

- `analysis` for the draft is shown only to admins, editable. The sole send path is the admin reply endpoint; this package has no such function.
- Never log `input`, `result.analysis` or `result.outcome` (author data). `meta` and `row` hold no prompts or PII.
- Plain contract method for simpler consumers: `ai.analyzeTicket(input): Promise<TicketAiAnalysis>`; it also never throws for provider/output problems but hides fallback status. Prefer `analyzeForPersistence`.
- Input: `ticketId`, `subject`, `description`, `authorContext` (only `name`, used locally for the greeting), optional `bookContext` (Book DTO fields; a whitelist is used), `history` (last 2 used), `knowledge` (override; omit to use the built-in versioned knowledge base). Dates in book facts must be `YYYY-MM-DD` strings.

### Retry and idempotency

- The provider already retries (`AI_MAX_RETRIES`, backoff, optional fallback model). Do not stack aggressive outer retries: retry `later` failures at most twice, at least a minute apart, and only for new/changed tickets.
- Create one attempt per trigger: ticket creation, a meaningful change (`inputFingerprint` differs), or an explicit admin refresh. Each `analyzeForPersistence` run is stateless and independent, so repeating it is safe, only costly.
- `AiAnalysis` has no column to store `inputFingerprint`. Interim safeguards: single-flight per ticket (skip if the latest attempt is PENDING and younger than `worstCaseAnalysisMs(config)` + margin), and a queue/job key of `ticketId + inputFingerprint`. A stale PENDING row can be closed as `FAILED` with `AI_ATTEMPT_ABANDONED`. A durable fingerprint column is listed under change requests.
- Latest attempt wins on read (creation time, then ID), as in `DATABASE_SCHEMA.md`.

## Change requests for Codex (none applied)

1. **Optional, recommended:** nullable `AiAnalysis.inputHash String?` (+ index on `[ticketId, inputHash]`) to persist `inputFingerprint` for durable dedupe. Not required for correctness.
2. No `packages/contracts` change is needed: `TicketAiAnalysis`, `aiAnalysisAttemptSchema` and the persisted columns already cover the mapping. `errorCode` stays a free nonempty string; the codes above are `AiErrorCode`.
3. Product decision for the owner: default FULL_FALLBACK → `FAILED` (`fullFallbackAs`), see above.

## Assumptions and limitations

- **₹1,000 payout threshold: needs source confirmation.** The supplied PDF text shows "1,000" with no currency symbol; `₹` follows `docs/AI_DESIGN.md`. The text lives in `src/knowledge/chunks.ts` (`kb.royalty-policy`) and in the royalty fallback draft in `src/drafting/fallback.ts`. Update both if the source says otherwise and bump `KB_VERSION`.
- Policy text is only the assignment's knowledge base. The model cannot know a payout date, royalty figure or production state beyond the supplied book facts; drafts then say the team will review and follow up.
- Dates in drafts must be exactly as supplied (`YYYY-MM-DD`); other renderings are rejected and fall back to the template.
- Retrieval is keyword-based; swap `KnowledgeRetriever` for embeddings if the knowledge base grows. Priority rubric and heuristics are product choices to review with BookLeaf operations (ISBN errors ≥ HIGH per policy; legal/fraud wording → CRITICAL).
- Attachments are UI-only now; any attachment text must be passed inside `description`/`history` so it is treated as untrusted.
- Cost is the provider-reported `usage.cost` only; unreported calls contribute `null`.
- Tests use mocked providers only. No live OpenRouter call has been made.

## Scripts

`npm run build`, `npm run typecheck`, `npm test` (vitest).
