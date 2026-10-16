# Real OpenRouter provider: configuration, evidence and verification status

**Status: VERIFIED WITH LIMITS.** Real requests reached OpenRouter on 2026-10-16 with the owner's key (free tier). With the default model `nvidia/nemotron-3-super-120b-a12b:free` and the final prompt, the model classified all six categories correctly in every run and produced a draft that passed the strict grounding validator in **12 of 13 analyses**. The sample is small and the model is non-deterministic, so this is evidence that the pipeline works with a real model, not a measured production acceptance rate. Account-level spend after all testing: **usage 0** (`GET /api/v1/key`: `is_free_tier: true`, `usage`, `usage_daily`, `usage_weekly` all 0).

Not verified: the alternative `google/gemma-4-31b-it:free` (its upstream provider returned HTTP 429 at every attempt, including a re-check at the end of testing); the full author-to-admin workflow on the deployed site with real AI; behaviour at sustained load or beyond the free-tier daily limit.

## Configuration

* Default model `nvidia/nemotron-3-super-120b-a12b:free` (`packages/ai/src/config.ts`, `infra/docker-compose.yml`, the `.env.example` files). Gemma 4 31B (`google/gemma-4-31b-it:free`) remains a supported alternative via `OPENROUTER_MODEL`. An `OPENROUTER_MODEL` set in `infra/.env` overrides the default (the owner's local file currently pins Gemma and should be changed or removed before relying on the new default).
* Zero-spend guard: against a real endpoint, `loadAiConfig` rejects any primary or fallback model id that does not end in `:free` (attempt recorded `AI_NOT_CONFIGURED`, **no request sent**). Loopback endpoints (the opt-in demo mock) are exempt. `tests/live/ai-real.mjs` also re-checks the live catalog price before any request. No paid fallback exists.
* Bounded behaviour: retries (default 2) with jittered backoff and `Retry-After`; 15 s timeout; `max_tokens` capped (default 400); requests send `reasoning: {enabled: false}`.
* A provider failure becomes a `FAILED` attempt with a stable error code. When the model output is only partly usable the stored rationale is prefixed with an explicit rule-based-fallback notice. Mock output is never substituted for a failed real call. The model never sends anything: the admin edits and explicitly sends a reply.

## Evidence: model eligibility (OpenRouter public API, rechecked 2026-10-16)

| Model | Provider | Context | Price (prompt / completion) | `response_format` | `structured_outputs` | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `nvidia/nemotron-3-super-120b-a12b:free` (default) | Nvidia | 262 144 | 0 / 0 | yes | yes | uptime 100% (30 min); reasoning model, so reasoning is disabled in requests |
| `google/gemma-4-31b-it:free` (alternative) | Google AI Studio | 262 144 | 0 / 0 | yes | no | upstream 429 throughout testing |
| `google/gemma-4-26b-a4b-it:free` | Google AI Studio | 262 144 | 0 / 0 | yes | no | not tested |

`openrouter/free` is a router with no stable model identity and is rejected by the guard. Documented free-tier limits: 20 requests/minute; 50 requests/day with fewer than 10 credits purchased, 1 000/day with at least 10. One analysis uses two model calls. **Correction after live deployment:** the documented 50 requests/day limit is real and was reached. During the live acceptance the provider answered `Rate limit exceeded: free-models-per-day`, limit 50, remaining 0, reset 2026-10-17T00:00Z. An earlier note here that more than 70 requests had succeeded in one day was wrong (the count was an estimate); plan for about 25 ticket analyses per day on a key without purchased credits.

**Privacy caveat (unverified).** OpenRouter's pages state that provider data handling follows each provider's own policy and that free models have separate training settings; free-model retention values were not shown. Free endpoints may log or train on prompts. Only synthetic tickets were used, and the application sends minimised text (no e-mail, phone, name or financial data). Review OpenRouter's account privacy settings before using real author data.

## Observed results (synthetic tickets, one per category)

What was found and fixed, in order. Each row is a real run of `tests/live/ai-real.mjs` on the model shown; the draft count is "passed the strict validator".

| Step | Model | Classification (model, correct) | Drafts accepted | Notes |
| --- | --- | --- | --- | --- |
| Original code | Gemma (default then) | not obtained | 0/6 | HTTP 429 upstream on every call; recorded `AI_RATE_LIMITED`, bounded retries, labelled fallback |
| Original code | Nemotron | 6/6 | 0/1 | Reasoning tokens consumed the output cap: empty content (`AI_INVALID_OUTPUT`) |
| Reasoning disabled | Nemotron | 6/6 | 0/1 | Draft began "Dear Author," instead of the placeholder |
| Greeting normalised | Nemotron | 6/6 | 3/6 | Royalty, book-status, general rejected: invented "within 48 hours" / "24-48 hours" |
| Prompt: tone/example labelled style-only, missing-facts rule | Nemotron | 6/6 | 4/6 | Royalty and general still rejected |
| Plus feature check and prompt tightening | Nemotron | 6/6 | 5/6 | Only royalty rejected, and only for "within 48 hours" |
| **Final: plus duration masking in style blocks** | Nemotron | **6/6, 6/6** | **5/6, 6/6** (+ 1/1) | General draft rejected once as `AI_UNGROUNDED_OUTPUT` (reason not captured); royalty now accepted in all three runs |

Final-prompt totals: 13 analyses, 26 requests, all reported cost 0, 4-14 s per analysis, about 2 200-2 700 tokens each.

### Why drafts were rejected (inspected on synthetic tickets)

The two rejected royalty drafts were fully grounded except for one sentence, "get back to you within 48 hours". Everything else (45-day cycle, the ₹1,000 minimum payout threshold, bank details linked in the dashboard) was supported by the royalty policy. The model copied the phrase from the royalty **style example** ("escalate with a 48-hour resolution timeline") and from the **tone guideline** ("give a clear timeline ('within 48 hours')"). Both sit in the prompt but not in the grounding sources, and they contradict the prompt's own time-frame rule.

### Decision on the 48-hour statements

Not silently rewritten. The knowledge-base text is unchanged and still contains the phrases. They are source guidance whose status as an operational or contractual commitment could not be verified; only the ISBN-error escalation (48 hours) is a grounded commitment and it keeps its explicit exemption. The AI guidance was changed instead: both blocks are labelled "style only, illustrations, NOT commitments", durations inside them are masked in the prompt, and a "when facts are missing" rule tells the model to acknowledge, say what the team will verify, name information the author could send, and make no commitment about dates, amounts, production stages, response times or distribution. **Open question for the owner:** if "within 48 hours" is a real company commitment for all escalations, add it to a policy chunk so it becomes citable; until then the AI will not promise it.

### Quality caveats on accepted drafts

The validator checks numbers, dates, durations, links, commitments, payout promises, completed-action claims and (new) invented quoted UI labels and e-mail replies. It cannot judge whether a sentence is wise or semantically accurate. Accepted real drafts still sometimes speculate gently (for example "it's possible the earnings have not reached the payout threshold") and a draft before the feature check named an "Author Profile" section that does not exist in the policy. Human review before sending remains essential and is enforced by the application.

## Provider-failure tests (real endpoint, `tests/live/ai-real-failures.mjs`, run 2026-10-16)

| Scenario | Result |
| --- | --- |
| Rejected credentials (real HTTP 401) | `AI_NOT_CONFIGURED`, **1 request, not retried**, no model output used |
| Nonexistent free model (real 4xx) | `AI_PROVIDER_ERROR`, 1 request, no model output used |
| Paid primary model configured | `AI_NOT_CONFIGURED`, **0 requests** (blocked before the network) |
| Paid fallback model configured | `AI_NOT_CONFIGURED`, **0 requests** |
| Gemma upstream rate limit (real HTTP 429) | `AI_RATE_LIMITED`, 2 requests (bounded retry), fallback labelled, no paid model tried |

Not exercised against the real provider: timeouts, 5xx, malformed JSON and prompt injection (covered by mock-provider tests: AI package 485, API suite).

## Running the acceptance tests (owner action)

1. `infra/.env` (git-ignored) holds `OPENROUTER_API_KEY`. Leave `OPENROUTER_BASE_URL` unset. To use the new default model, remove `OPENROUTER_MODEL` from the file or set it to the Nemotron id.
2. `npm run build`, then `node tests/live/ai-real.mjs` (six synthetic tickets, about 12 calls, 4 s apart; exit 0 pass, 1 fail, 2 blocked) and `node tests/live/ai-real-failures.mjs` (set `CHECK_DEFAULT_ALT=1` to include the Gemma probe). Neither prints the key, prompts or responses.
3. Because real drafts are non-deterministic, a single failing draft is not necessarily a regression; repeat the run before drawing conclusions.


## Update 2026-10-16 (final code, commit 3eb1aff)

* **Provider/model:** OpenRouter `/chat/completions`, `nvidia/nemotron-3-super-120b-a12b:free` (verified $0 per prompt/completion token, supports `response_format`). Zero-spend guard: only `:free` model ids are accepted. Temperature 0 (classify) / 0.2 (draft), JSON mode, reasoning disabled, 800-token output cap, 15 s timeout, up to 2 retries with backoff, usage and provider-reported cost recorded per call.
* **Pipeline:** retrieve policy chunks (`bookleaf-assignment-kb-v2`, includes the 3-5 business day metadata-update topic) -> classify (category, priority, confidence, rationale, citations) -> draft -> deterministic validation (schema, citations must be retrieved chunks, no invented numbers/dates/time frames/links/refunds/features, no completed-action or payout promises, time frames only from the answered topic) -> admin review. Priority floors (legal/fraud, ISBN errors) and the live-book metadata-update rule are deterministic.
* **Fixes from the real run:** live-book description/metadata updates are General Inquiry (the model had said Distribution and quoted the wrong 7-10 day timeline); future conditions ("to confirm the issue is resolved", "if royalties are due") no longer trip the completed-action/payout checks while real completed claims are still rejected; plain-text replies, trailing `Citations:` lines and stray JSON are normalised or rejected; output budget raised from 400 to 800 tokens (400 truncated valid JSON).
* **Results (three runs, 6 tickets each, 12 calls, ~14.8k tokens, reported cost $0):** classification and priority 6/6 each time; model draft accepted 5/6 each time. The book-status draft was rejected each time (the model promised an invented timeline) and a labelled policy-template draft was produced. The royalty trap ticket (asks for an exact date/amount and claims it was sent) never yielded an invented date, amount or completed action.
* **Live site (2026-10-16 08:05 UTC):** six analyses ended `FAILED` / `AI_RATE_LIMITED` because the key's free daily quota was exhausted. This verifies failure handling (no draft, nothing sent, tickets intact), not live inference. No successful live inference is claimed.
