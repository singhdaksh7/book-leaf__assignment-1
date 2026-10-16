# Real OpenRouter provider: evidence and status

**Status: PARTIALLY VERIFIED, not a full pass.** Real requests reached OpenRouter on 2026-10-16 with the owner's key (free tier, account usage $0). The default model could not be tested because of an upstream rate limit; the alternative free model classified all six categories correctly but only 3 of 6 drafts passed validation. `node tests/live/ai-real.mjs` currently exits 1. The "Evidence" section was read from OpenRouter's public endpoints; the "Observed results" section is measured.

## Observed results (synthetic tickets, one per category; no credentials or prompts recorded)

| Model | Outcome |
| --- | --- |
| `google/gemma-4-31b-it:free` (default) | **Not verified.** Every request returned HTTP 429 from the upstream provider (Google AI Studio: "temporarily rate-limited upstream"), over several attempts across the session. The application recorded `AI_RATE_LIMITED`, retried within its bounds, and fell back to rule-based output with the visible notice. No paid model was tried |
| `nvidia/nemotron-3-super-120b-a12b:free` (alternative) | Full run of six tickets: **12 calls, 14 015 tokens, reported cost 0**, 3.5-10 s per analysis. Classification by the model: **6/6 correct** categories. Drafts accepted: **3/6** (ISBN, printing quality, distribution). Royalty, book-status and general-inquiry drafts were rejected as `AI_UNGROUNDED_OUTPUT` and replaced by the rule-based template. In a later two-ticket re-run the royalty draft failed as `AI_INVALID_OUTPUT` instead (cause not inspected), while ISBN passed again; results vary between runs |

Why drafts were rejected (inspected for one synthetic general-inquiry ticket and one royalty ticket): the model wrote fluent, relevant replies but invented specifics that are not in the knowledge base: turnaround times ("within 24-48 hours", "within 48 hours") and a dashboard "Author Profile" section. The strict grounding check is designed to reject exactly that, so this is the safeguard working, not an application fault. Part of the cause is the knowledge base itself: its tone guideline tells the writer to "give a clear timeline (within 48 hours)", which conflicts with the strict rule that a timeframe may only be promised if a policy excerpt states it. That policy text was not changed.

Two real-model incompatibilities found and fixed by this run:

1. **Reasoning models returned empty content.** Hidden reasoning tokens consumed the 400-token output cap, giving `AI_INVALID_OUTPUT`. The request now sends `reasoning: {enabled: false}`.
2. **Greeting.** The model wrote "Dear Author," instead of the required `{{authorFirstName}}` placeholder. A generic salutation ("Dear Author/Valued Author/Writer,") is now normalised; a personal name such as "Dear John," is still rejected (existing test kept intact). The request-key allow-list test was extended to include `reasoning`.

Other checks made: the key is valid and on the free tier (`/api/v1/key`: `is_free_tier: true`, usage 0); the catalog price of both models was re-verified as 0 immediately before each run; the key was read only from `infra/.env` (git-ignored) and never printed.

**What is not verified:** the default model's behaviour; the full author-to-admin-to-author workflow through the deployed app with real AI; prompt-injection and failure-mode behaviour against the real provider (covered by mock tests only); rate-limit behaviour beyond the 429 above. A free-model draft pass rate of 50% means admins will often see the rule-based fallback; this is acceptable for the human-in-the-loop design but should be stated to reviewers. Recommended next steps (owner decisions): choose which free model to default to once Gemma's upstream limit clears, and decide whether to adjust the knowledge-base tone guideline so it does not conflict with strict grounding.

## What the code does

* Default model `google/gemma-4-31b-it:free` (`packages/ai/src/config.ts`, `infra/docker-compose.yml`, `.env.example` files). The earlier default `openai/gpt-4o-mini` was a **paid** model and was removed.
* Zero-spend guard: against a real endpoint, `loadAiConfig` rejects any primary or fallback model id that does not end in `:free` (attempt recorded as `AI_NOT_CONFIGURED`, no request sent). Loopback endpoints (the opt-in demo mock) are exempt. The guard is a first line only; `tests/live/ai-real.mjs` additionally checks the live catalog price before any request.
* No paid fallback exists; the optional fallback model is subject to the same guard. Retries are bounded (default 2) and timeouts are explicit (15 s); `max_tokens` is capped (default 400).
* A provider failure becomes a `FAILED` attempt with a stable `errorCode` (`AI_RATE_LIMITED`, `AI_TIMEOUT`, `AI_PROVIDER_ERROR`, `AI_NETWORK_ERROR`, `AI_NOT_CONFIGURED`, `AI_INVALID_OUTPUT`). It is never replaced by mock output. When the model output is only partly usable, the stored rationale is prefixed with an explicit rule-based-fallback notice.
* The model never sends anything: the admin edits and explicitly sends a reply through the normal reply endpoint.

## Evidence (OpenRouter public API, 2026-10-16)

`GET /api/v1/models` returned 465 models, 18 with zero prompt and completion price. Per-model `GET /api/v1/models/{id}/endpoints`:

| Model | Provider | Context | Max completion | Price (prompt / completion) | `response_format` | `structured_outputs` |
| --- | --- | --- | --- | --- | --- | --- |
| `google/gemma-4-31b-it:free` (default) | Google AI Studio | 262 144 | 32 768 | 0 / 0 | yes | no |
| `nvidia/nemotron-3-super-120b-a12b:free` (alternative) | Nvidia | 262 144 | 235 929 | 0 / 0 | yes | yes |
| `google/gemma-4-26b-a4b-it:free` | Google AI Studio | 262 144 | 32 768 | 0 / 0 | yes | no |

The request uses `response_format: {type: "json_object"}`, supported by all three. Gemma 4 31B was chosen because it is a stable named model; Nemotron 3 Super is the recommended second choice (it also supports `structured_outputs`). `openrouter/free` is a router with no stable model identity and is rejected by the guard.

Documented free-tier limits (OpenRouter docs): 20 requests/minute; 50 requests/day with fewer than 10 credits purchased, 1 000/day with at least 10 purchased. The docs do not say whether failed requests count. One ticket analysis uses two model calls (classify + draft), so a no-credit key supports roughly 25 analyses per day.

**Privacy caveat (unverified).** OpenRouter's pages state that provider data handling is governed by each provider's own policy and that free models have separate training settings, but they did not state free-model retention values. Free endpoints may log or train on prompts. The application therefore sends only minimised text (no e-mail, phone, name or financial data; see `docs/architecture/09-AI-ARCHITECTURE.md`), and only synthetic tickets must be used for acceptance testing. A real deployment with real author data should be reviewed against OpenRouter's account privacy settings first.

## Running the acceptance test (owner action)

1. Create `infra/.env` (already git-ignored: `.gitignore` line 39) from `infra/.env.example` and set `OPENROUTER_API_KEY=` to the key. Never paste the key into chat or commit it. Leave `OPENROUTER_BASE_URL` unset. Docker Compose reads `infra/.env` automatically when run from `infra/`.
2. `npm run build`, then `node tests/live/ai-real.mjs`. It loads only `OPENROUTER_*`/`AI_*` variables from `infra/.env`, refuses a loopback URL, verifies zero pricing from the live catalog, runs six synthetic tickets (one per category, ≈12 model calls, 4 s apart) through the real `@bookleaf/ai` package, and prints only metadata (category, priority, confidence, source, tokens, latency). Exit codes: 0 pass, 1 fail, 2 blocked (no key, nothing sent).
3. Only a run that prints `REAL OPENROUTER TEST PASSED` counts as verification; this document must then be updated with the observed results.

Without the key the script exits 2 with `BLOCKED: OPENROUTER_API_KEY is not set` (verified).
