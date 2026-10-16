# Real OpenRouter provider: evidence and status

**Status: real-provider acceptance is BLOCKED.** No `OPENROUTER_API_KEY` is configured anywhere this project can reach, so no real inference request has been made. Everything below the "Evidence" heading was read from OpenRouter's public endpoints on 2026-10-16; nothing here is a measured result.

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

Without the key the script exits with `BLOCKED: OPENROUTER_API_KEY is not set` (verified this session).
