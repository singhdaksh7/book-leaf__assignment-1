# @bookleaf/ai

Policy-grounded ticket analysis for the BookLeaf Author Support Portal: category, priority, a cited draft reply for **admin review**. Server-side only. No Express, Prisma or database imports; no network call happens unless the backend invokes the service.

## What it does

`analyzeTicket(input)` runs two bounded model calls through OpenRouter:

1. **Classify** into one of the six contract categories and four priorities (`classifier/`).
2. **Draft** an author reply from the retrieved BookLeaf policy (`drafting/`).

Both steps degrade to deterministic results instead of failing, so ticket handling is never blocked.

| Safeguard | Behaviour |
| --- | --- |
| Human review | Result is parsed through `aiAnalysisSchema`; `requiresHumanReview` is always `true`. The package has no send/notify capability: only an explicit admin reply action in the API sends anything. |
| Grounding | Drafts are rejected if any number or date is not in the ticket, book facts or retrieved policy, if they say an action was already done, promise a payout, offer a refund/compensation, or contain links/email addresses. |
| Citations | Must be ids of retrieved policy chunks. Unknown ids reject the output. If the model cites nothing, the category's own policy chunk is cited. |
| Fallback | Provider timeout, rate limit, error, malformed JSON, schema failure or rejected claims → heuristic classification (confidence ≤ 0.3) and/or a fixed policy-only draft (overall confidence ≤ 0.5). If the provider is down, the second model call is skipped. |
| Injection | Ticket text, history and attachment text are sanitized, placed in random-nonce `<untrusted-…>` blocks, and treated as data. Output is strict-schema validated (unknown fields rejected). Suspected attempts are reported in `meta.securityFlags` and cap confidence. |
| Privacy | Author name, phone, city, email and unrelated book fields are never sent to the model. The greeting uses a placeholder replaced locally. Logs receive codes and counters only. |
| Cost | ≤ 3 policy chunks / 2,400 chars for classification, ≤ 2 chunks / 1,800 chars for drafting, truncated ticket text, 2 history messages, capped output tokens, static system prompts (cache-friendly), temperature 0 / 0.2, bounded retries. |

## Configuration (server environment)

See `.env.example`. Nothing is read from the browser or committed.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | none (required) | Credential. Missing/invalid → analyses use fallbacks with reason `AI_NOT_CONFIGURED`. |
| `OPENROUTER_MODEL` | `openai/gpt-4o-mini` | Primary model. |
| `OPENROUTER_FALLBACK_MODEL` | unset | Used once, only after retryable failures of the primary. |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | Must be https (http allowed for localhost only). |
| `OPENROUTER_APP_NAME`, `OPENROUTER_APP_URL` | name set, URL unset | Optional attribution headers. |
| `AI_TIMEOUT_MS` | `15000` | Per-attempt timeout (1,000–120,000). |
| `AI_MAX_RETRIES` | `2` | Extra attempts per model for 429/5xx/timeout/network (0–5). |
| `AI_RETRY_BASE_DELAY_MS` / `AI_RETRY_MAX_DELAY_MS` | `500` / `4000` | Exponential backoff with jitter; `Retry-After` honoured. |
| `AI_MAX_OUTPUT_TOKENS` | `400` | Hard ceiling on completion tokens for every call. |

## Backend integration

```ts
import { createAiServiceFromEnv, UsageTracker, AiUnavailableError } from "@bookleaf/ai";
import type { AiService, AnalysisOutcome, AnalyzeTicketInput } from "@bookleaf/ai";

const usage = new UsageTracker();                       // optional, in-memory metrics
const ai = createAiServiceFromEnv(process.env, { usageTracker: usage, logger });  // never throws

// Contract method (what routes depend on): resolves with TicketAiAnalysis
//   { category, priority, confidence, rationale, draftResponse, requiresHumanReview: true, knowledgeBaseCitations }
const analysis = await ai.analyzeTicket(input);

// Same plus server-side metadata for AiAnalysis persistence/metrics (do not send to the browser)
const { analysis: a, meta }: AnalysisOutcome = await ai.analyzeTicketDetailed(input);
// meta: { kbVersion, classificationSource: "model"|"heuristic", draftSource: "model"|"fallback",
//         fallbackReasons: AiErrorCode[], securityFlags: string[], usage: UsageRecord[],
//         totalTokens: number, costUsd: number | null }
```

Input (`AnalyzeTicketInput`): `ticketId`, `subject`, `description`, `authorContext` (only `name` is read, locally, for the greeting), optional `bookContext` (the `Book` DTO fields; only a whitelist is sent), optional `history` (last 2 messages used), optional `knowledge` (override; omit to use the built-in versioned knowledge base).

Recommended wiring:

- Create the ticket first; call `analyzeTicketDetailed` afterwards (queue/background). Store `analysis` → `AiAnalysis` result fields, `knowledgeBaseCitations` → `citations`, and `meta` → server-only fields.
- `analyzeTicket` does not throw for provider or output problems. It resolves with fallbacks; use `meta.draftSource`/`classificationSource`/`fallbackReasons` to show admins that a result is automatic. If you prefer to record a `FAILED` attempt when the model was unusable, check `meta.fallbackReasons.length > 0`; the error codes are `AiErrorCode` values and safe to store.
- `AiUnavailableError` (with `.code`) is exported for custom providers; the shipped service does not throw it.
- Show the draft only to admins, editable. Send only through the explicit admin reply endpoint. Never expose `meta` prompts/usage to authors.
- Never log `input` or `analysis`; they contain author data.

## Assumptions and limitations

- **₹1,000 payout threshold:** the supplied PDF text shows "1,000" without a currency symbol; `₹` follows `docs/AI_DESIGN.md` and is pending confirmation against the source. Policy text lives in `src/knowledge/chunks.ts` (`KB_VERSION`).
- The knowledge base holds only the assignment's policies. The model cannot know a specific payout date, royalty figure or production state beyond the supplied book facts, so such drafts say the team will confirm within 48 hours (the tone guideline's example timeline).
- Dates in drafts must use the exact `YYYY-MM-DD` form of the supplied facts; other renderings are rejected and fall back to the template.
- Retrieval is keyword-based. Replace `KnowledgeRetriever` with embeddings if the knowledge base grows.
- Classification heuristics and priority rubric are product choices to review with BookLeaf operations. Policy-derived floors: reported ISBN errors ≥ HIGH; legal/fraud wording → CRITICAL.
- Attachments are UI-only in this phase; attachment text, if added later, must be passed inside `description`/`history` so it is treated as untrusted.
- Cost is the provider-reported `usage.cost` only; calls whose cost is not reported contribute `null`, not zero.
- Tests use mocked providers only. No live OpenRouter call has been made.

## Scripts

`npm run build`, `npm run typecheck`, `npm test` (vitest).
