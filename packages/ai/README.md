# @bookleaf/ai

Policy-grounded ticket analysis for the BookLeaf Author Support Portal: category, priority and a cited draft reply for **admin review**.

Server-side only. No Express, Prisma or database imports. The package never sends a message, never changes ticket status, and makes no network call unless the backend invokes it. A failed or unavailable AI never blocks ticket creation or a manual admin reply.

## Contents

1. [Behaviour](#behaviour) · 2. [Configuration](#configuration-server-environment) · 3. [Security model](#security-model) · 4. [Persistence mapping](#persistence-mapping-aianalysis) · 5. [Failure states and retries](#failure-states-and-retries) · 6. [Backend integration](#backend-integration) · 7. [Cost and latency](#cost-and-latency-limits) · 8. [Operations review](#operations-review-required-before-launch) · 9. [Limitations and blockers](#known-limitations-and-integration-blockers) · 10. [Verification](#verification)

## Behaviour

`analyzeTicket(input)` runs at most two bounded OpenRouter calls:

1. **Classify** into the six contract categories (`ROYALTY_PAYMENTS`, `ISBN_METADATA`, `PRINTING_QUALITY`, `DISTRIBUTION_AVAILABILITY`, `BOOK_STATUS_PRODUCTION`, `GENERAL_INQUIRY`) and four priorities (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`). Policy-derived floors only raise priority: a reported ISBN error is at least `HIGH` (BookLeaf ISBN policy); legal/fraud wording is `CRITICAL`.
2. **Draft** an author reply from the retrieved BookLeaf policy, in the tone guidelines, with citations.

Each step degrades to a deterministic result (keyword classification; fixed policy-only draft) instead of throwing. If the provider call fails, the second call is skipped.

The result is parsed through the shared `aiAnalysisSchema`: exactly `category, priority, confidence, rationale, draftResponse, requiresHumanReview: true, knowledgeBaseCitations`. `requiresHumanReview` cannot be anything but `true`.

### Draft rules (enforced by code, not only by the prompt)

A model draft is used only if it passes all of these; otherwise the fixed template is used.

| Rule | Rejected examples |
| --- | --- |
| Strict JSON schema; must start `Dear {{authorFirstName}},`; unknown fields rejected | extra `autoSend` field, missing greeting, other `{{…}}` |
| Citations are ids of the policy chunks retrieved for this ticket | invented id, `kb.tone-guidelines`, example chunks |
| Every number and date appears in the ticket, book facts or retrieved policy (date digits do not ground loose numbers) | "15% fee", "₹9,999", a new payout date |
| Time frames must match the source exactly (same number/range and unit); spelled-out or relative time frames only if the author or policy used the same words | "within 7 days" (7 appears in "5–7 business days"), "within a week", "tomorrow", "by Friday", "48 hours" outside ISBN errors |
| No completed-action claims | "we have processed", "our team has escalated", "is now fixed" |
| No payout promises | "your royalty is guaranteed", "₹2,500 will be credited", "you will receive … next quarter", a future payout on any date |
| No refund, compensation, credit, voucher, cashback, money-back, free copies, guarantees | "we will arrange a refund" (policy remedy for verified defects is a free reprint) |
| Plain text only: no markup, links, email addresses or domains | `<script>`, `[x](javascript:…)`, `bookleaf.com` |

**Response time frames.** The source documents give a **48-hour timeline only for reported ISBN errors**. The tone guideline's "48 hours" is an example, not a general guarantee. Other time frames come only from policy text (5–7 business days reprint, 7–10 business days listing, 24–48 hours re-sync, 45 days royalty window). Fallback drafts promise no response time; they say the team will follow up.

The royalty `₹1,000` threshold is flagged below.

## Configuration (server environment)

See `.env.example` (names only). Never expose these to `apps/web`; never commit values.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | none (required) | Missing/invalid → fallbacks with reason `AI_NOT_CONFIGURED`; no network call is made. |
| `OPENROUTER_MODEL` | `openai/gpt-4o-mini` | Primary model (configurable; chosen for low cost). |
| `OPENROUTER_FALLBACK_MODEL` | unset | Tried once, only after retryable failures of the primary. |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | https required (http only for localhost). |
| `OPENROUTER_APP_NAME`, `OPENROUTER_APP_URL` | name set, URL unset | Optional attribution headers. |
| `AI_TIMEOUT_MS` | `15000` | Per-attempt timeout (1,000–120,000). |
| `AI_MAX_RETRIES` | `2` | Extra attempts per model for 429/5xx/timeout/network (0–5). |
| `AI_RETRY_BASE_DELAY_MS` / `AI_RETRY_MAX_DELAY_MS` | `500` / `4000` | Exponential backoff with jitter; `Retry-After` honoured but clamped to the max. |
| `AI_MAX_OUTPUT_TOKENS` | `400` | Ceiling on completion tokens for every call. |

Invalid values fail closed with `AI_NOT_CONFIGURED`; the error names the variable, never the value.

## Security model

| Threat | Control | Tested in |
| --- | --- | --- |
| Prompt injection in description, attachment text, subject, author or admin history | All ticket text is sanitized (NFKC, control/bidi/zero-width removal, `<` `>` neutralised, truncated) and placed in a random-nonce `<untrusted-…>` block; system prompt states it is data, not instructions; injection heuristics flag attempts (`meta.securityFlags`) and cap confidence at 0.6; flags never gate or alter the category | `security.test.ts` (9 attack payloads × 5 channels) |
| Model obeys an injection | Strict output schema, citation check, grounding/strict-claim checks → template draft | `security.test.ts` |
| Model output causing side effects | The package only returns data. Requests carry no `tools`/`functions`; `tool_calls`/`function_call` responses are invalid output; redirects are refused; the only URL ever contacted is `<base>/chat/completions` | `security.test.ts` |
| Author PII in prompts | Author name/email/phone/city never sent (greeting is a local placeholder); emails, phone numbers and account/card-like digit runs typed into tickets are redacted (ISBN-13s, dates and amounts kept); book facts are whitelisted | `security.test.ts` |
| Secrets in logs/results/bundles | Key held in a redacting `Secret`; errors are sanitized codes with no provider body; the logger receives codes and counters only; no `console` use; `process.env` read only in `config.ts`/`service.ts`; package uses Node built-ins (`node:crypto`) so it cannot be bundled for a browser; `apps/web` must not depend on it | `security.test.ts`, `contract-package.test.ts` |
| Output abuse | Raw model output over 20,000 characters is rejected before parsing; drafts ≤ 2,500 characters | `security.test.ts` |

Rendering: drafts and rationales are plain text. The admin UI must render them as text (React's default), not as HTML.

## Persistence mapping (`AiAnalysis`)

Helpers use the Prisma field names with plain types (`AiAnalysisRowData`). They are pure; the backend owns the client, transactions and `Prisma.DbNull`.

| Column | Source |
| --- | --- |
| `status` | `PENDING` on creation; `COMPLETED`/`FAILED` from `decideAttempt` |
| `promptVersion` | `PROMPT_VERSION` (`<KB_VERSION>/classify-v1/draft-v1`); required, written on every row |
| `model` | distinct models used, comma-joined (≤ 120 chars); `null` if no completion was made |
| `category`, `priority`, `confidence`, `rationale`, `draftResponse` | `analysis.*`; `null` unless COMPLETED |
| `citations` | `analysis.knowledgeBaseCitations` (string[], may be empty); `null` unless COMPLETED (write `Prisma.DbNull`) |
| `inputTokens`, `outputTokens` | sums over all completions, **including rejected ones** (they were billed); `null` if none |
| `costMicrounits` | `round(costUsd × 1,000,000)`; **`null` when the provider reported no cost, never 0** |
| `errorCode` | `null` unless FAILED; then a sanitized `AiErrorCode` |
| `requiresHumanReview` | not stored; `serializeAttempt` injects literal `true` |

## Failure states and retries

`meta.fallbackReasons` being non-empty does **not** mean FAILED. `decideAttempt` rule:

| Classification | Draft | State | Meaning |
| --- | --- | --- | --- |
| model | model | `COMPLETED` (MODEL) | normal |
| model | fallback | `COMPLETED` (PARTIAL_FALLBACK) | model category/priority; safe template draft (draft call failed or draft rejected) |
| heuristic | model | `COMPLETED` (PARTIAL_FALLBACK) | keyword category/priority (confidence ≤ 0.3) with a validated model draft |
| heuristic | fallback | **`FAILED`** (owner decision, the default) | no usable model output: provider down, not configured, or all output rejected |

`{ fullFallbackAs: "COMPLETED" }` exists but must not be used unless the owner changes the decision. A `FAILED` attempt is `analysis: null` over HTTP; the deterministic analysis is returned in `decision.fallbackAnalysis` only for an optional admin-only template suggestion and is not persisted as an AI result.

`errorCode` for FAILED prefers a transient reason, so the attempt is retried rather than treated as bad model output.

| Code | `retry` advice | Backend action |
| --- | --- | --- |
| `AI_TIMEOUT`, `AI_RATE_LIMITED`, `AI_PROVIDER_ERROR` (5xx, 429, 4xx other than 401/403), `AI_NETWORK_ERROR` | `later` | optional delayed retry |
| `AI_ATTEMPT_ABANDONED` | `later` | written by the backend for a stale PENDING row |
| `AI_INVALID_OUTPUT`, `AI_UNGROUNDED_OUTPUT`, `AI_INTERNAL_ERROR` | `manual` | no automatic loop; an admin refresh creates a new attempt |
| `AI_NOT_CONFIGURED` (missing/invalid config, or 401/403 from the provider) | `after-config` | retrying cannot help until the key/config is fixed |
| `AI_RESULT_INVALID` | n/a | `serializeAttempt` withholds a malformed COMPLETED row |

State transitions: `PENDING → COMPLETED | FAILED`, and a stale `PENDING → FAILED (AI_ATTEMPT_ABANDONED)`. Write state and result in one update.

**Abandoned attempts.** If the worker dies, a row stays `PENDING`. When `isPendingAttemptAbandoned(row.createdAt, config)` is true (older than `worstCaseAnalysisMs(config)` + 30 s), update it with `abandonedRow()` and optionally enqueue one new attempt. A younger `PENDING` row must be left alone (single-flight: never two concurrent analyses per ticket).

**Retry and idempotency.** The provider already retries (backoff, optional fallback model); do not stack aggressive outer retries: retry `later` failures at most twice, at least a minute apart, and only for new or changed tickets. Create one attempt per trigger (ticket creation, a meaningful change, an explicit admin refresh). `inputFingerprint(input)` (SHA-256 of normalized subject/description, the last 2 history messages, whitelisted book facts, knowledge override and `PROMPT_VERSION`; it ignores ticket/author ids, whitespace, key order, non-whitelisted fields) identifies redundant work. Equal fingerprints do not make a run cached: each run is an independent paid call, so dedupe is the backend's job (no column stores the fingerprint; see change requests).

## Backend integration

```ts
import {
  createAiServiceFromEnv, UsageTracker, analyzeForPersistence, pendingRow, serializeAttempt,
  inputFingerprint, isPendingAttemptAbandoned, abandonedRow, worstCaseAnalysisMs
} from "@bookleaf/ai";
import type { AnalyzeTicketInput } from "@bookleaf/ai";
import { Prisma } from "@bookleaf/db";

const ai = createAiServiceFromEnv(process.env, { usageTracker: new UsageTracker(), logger });   // never throws

// 1. Create the ticket first. AI never runs inside the request that creates it.
// 2. Background job (bounded concurrency, single-flight per ticket):
async function runAnalysis(prisma, ticketId: string, input: AnalyzeTicketInput) {
  const attempt = await prisma.aiAnalysis.create({ data: { ticketId, ...dbNull(pendingRow()) } });
  const result = await analyzeForPersistence(ai, input);                                          // never throws
  await prisma.aiAnalysis.update({ where: { id: attempt.id }, data: dbNull(result.row) });        // state + result together
  // result.status === "FAILED": use result.retry; do NOT change ticket status or create a message.
}
const dbNull = (row) => ({ ...row, citations: row.citations ?? Prisma.DbNull });

// 3. Reads: latest row → serializeAttempt(row) (validates invariants, drops internals)
// 4. Sweeper: PENDING rows with isPendingAttemptAbandoned(row.createdAt, config) → update with abandonedRow()
```

- Show the draft only to admins, editable. The only send path is the explicit admin reply endpoint; this package has no such function.
- Never log `input`, `result.analysis`, `result.fallbackAnalysis` or `result.outcome` (author data). `row` and `meta` hold no prompts or PII.
- `ai.analyzeTicket(input)` is the plain contract method; it hides fallback status, so prefer `analyzeForPersistence`.
- Input: `ticketId`, `subject`, `description`, `authorContext` (only `name`, used locally for the greeting), optional `bookContext` (a Book DTO; a whitelist is used and nulls are preserved), `history` (last 2 used), `knowledge` (trusted override; omit for the built-in versioned knowledge base). Attachment text, if added later, must be passed inside `description`/`history` so it is treated as untrusted. Book dates must be `YYYY-MM-DD` strings.
- Run analyses through a queue with a small concurrency limit (for example 2–4) to respect OpenRouter rate limits; the package does not rate-limit across calls.

## Cost and latency limits

Measured with hostile maximum-size input (tests assert ceilings). Token figures are character count ÷ 4 for English; Devanagari text can take 2–3× more tokens.

| | Classify | Draft |
| --- | --- | --- |
| Prompt, typical ticket | ≈ 2.9k chars (≈ 0.7k tokens) | ≈ 4.5k chars (≈ 1.1k tokens) |
| Prompt, maximum (any input size) | ≈ 7.5k chars (≈ 1.9k tokens) | ≈ 8.9k chars (≈ 2.3k tokens) |
| Output cap | 250 tokens | 500 requested, hard ceiling `AI_MAX_OUTPUT_TOKENS` (400) |
| Policy context | ≤ 3 chunks, ≤ 2,400 chars | ≤ 2 chunks, ≤ 1,800 chars, plus tone and one style example |
| Other caps | subject 200, description 2,000 chars; last 2 history messages × 300 chars | same |

A full analysis is at most **2 model calls**; 1 if the provider fails on classification. Typical total ≈ 1.8k input + < 0.65k output tokens; worst case ≈ 4.2k input + 650 output (English).

Maximum execution time per analysis (`worstCaseAnalysisMs`): `2 × models × ((retries + 1) × timeout + backoff)`.

| Configuration | Worst case |
| --- | --- |
| Defaults (15 s timeout, 2 retries, no fallback model) | 93 s (provider outage: 46.5 s, classification only) |
| Defaults + fallback model | 186 s (outage: 93 s) |
| `AI_TIMEOUT_MS=10000`, `AI_MAX_RETRIES=1` | 41 s |
| `AI_MAX_RETRIES=0` | 30 s |

Normal latency is two sequential model calls; it was not measured because no live call has been made. Cost is the provider-reported `usage.cost` only; unreported calls contribute `null`. Tokens and cost of rejected completions are kept.

## Operations review required before launch

These are product decisions encoded in code; BookLeaf operations should confirm them.

1. **₹1,000 payout threshold: needs source confirmation.** The supplied PDF text shows "1,000" without a currency symbol; `₹` follows `docs/AI_DESIGN.md`. It appears in `kb.royalty-policy` (`src/knowledge/chunks.ts`) and the royalty fallback draft (`src/drafting/fallback.ts`). Update both and bump `KB_VERSION` if the source differs.
2. Priority rubric (system prompt in `src/classifier/prompt.ts`) and keyword heuristics, including the Hindi/Hinglish terms (best effort).
3. The 48-hour timeline applies only to reported ISBN errors, per the source examples. Confirm whether other categories have an approved response time.
4. The fixed fallback draft wording (`src/drafting/fallback.ts`).
5. The default that a full fallback is `FAILED`, not shown as an AI result.
6. Monitor the rate of `draftSource: "fallback"` and `AI_UNGROUNDED_OUTPUT`: a high rate means the strict checks are rejecting acceptable drafts (for example date formats) and the prompt or checks need tuning against real model output.
7. Drafts are written in English. For non-English tickets the classification works (model) or best-effort (heuristics), but an admin must translate or adapt the reply.

## Known limitations and integration blockers

- No live OpenRouter call has been made; model behaviour under the strict checks is unobserved.
- Retrieval is keyword-based; swap `KnowledgeRetriever` for embeddings if the knowledge base grows.
- Policy text is only the assignment's knowledge base; the model cannot know a payout date, royalty calculation or production state beyond the supplied book facts. It then says the team will review and follow up.
- Dates in drafts must be exact `YYYY-MM-DD` values from the supplied facts; other renderings fall back to the template.
- The fingerprint cannot be persisted without a schema column. Interim: single-flight plus a queue key `ticketId + inputFingerprint`.
- Rate limiting across concurrent analyses is the backend's responsibility.
- **Blocker for a clean install:** `packages/ai` adds devDependencies `vitest` and `@types/node`; the root `package-lock.json` must be regenerated by Codex. A fresh isolated install of `contracts` + `ai` (workspace root included for `typescript`) was verified: typecheck, all tests and `verify:package` pass.

### Change requests for Codex (none applied)

1. Regenerate the root `package-lock.json` for the new `packages/ai` devDependencies.
2. Optional: nullable `AiAnalysis.inputHash String?` (index on `[ticketId, inputHash]`) for durable dedupe.
3. No `packages/contracts` change is needed.

## Verification

```
npm run typecheck --workspace @bookleaf/ai     # src and tests
npm test --workspace @bookleaf/ai              # vitest, mocked provider only
npm run verify:package --workspace @bookleaf/ai  # builds, imports dist offline, checks exports
```

Test files: `openrouter` (provider, config), `knowledge-grounding`, `classifier`, `service` (end-to-end scenarios), `persistence` (mapping, states), `security`, `reliability`, `limits`, `classification-matrix` (6 categories × 4 priorities, Hindi/Hinglish, ambiguous), `contract-package` (shared-contract and package checks). No test makes a network call.
