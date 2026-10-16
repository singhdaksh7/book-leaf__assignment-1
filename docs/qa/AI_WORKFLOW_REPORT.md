# AI workflow report

**The staging AI is a deterministic keyword matcher, not a language model.** Everything below shows that the BookLeaf pipeline
(prompting, validation, grounding, persistence, retry, privacy filtering, human review UI) behaves correctly. None of it measures the
quality, latency, cost or safety of real OpenRouter inference, which was never exercised. No paid request was made and the staging
key is a dummy value.

## 1. How it is wired on staging

| Aspect | Observed |
| --- | --- |
| Enablement | `infra/docker-compose.demo.yml` applied; it sets `MOCK_AI_ACK=demonstration-only`, a dummy key and model, and `OPENROUTER_BASE_URL=http://127.0.0.1:8080/api/v1` |
| Process | `infra/mock-ai/server.mjs` runs as a supervised background process inside the API container (`while true; ...; done & exec node dist/server.js`); no separate container |
| Reachability | listens on `127.0.0.1:8080` only; from the host, the API container's port 8080 is refused; no published ports; nothing reachable from outside |
| Acknowledgement | a start without `MOCK_AI_ACK=demonstration-only` exits with "refusing to start" (tested for empty, "yes", "true", unset) |
| External calls | none by the mock (its source has no network client); the API's observed TCP peers during AI calls were only loopback and PostgreSQL; the API log has no OpenRouter host. The container does have internet egress, so "no external calls" rests on configuration plus those observations, not a network block |
| Base configuration | the base compose file has no mock, no base URL, no dummy values; without the override and with an empty key, analyses record `AI_NOT_CONFIGURED` |

## 2. Six categories (live, through the public URL; 34/34 checks, run three times)

| Category | Classified as | Priority | Draft | Labels | Money in draft |
| --- | --- | --- | --- | --- | --- |
| Royalty and payments | ROYALTY_PAYMENTS | HIGH | yes | `[DEMO MOCK ...]` in rationale, `[DEMO DRAFT ...]` in draft | none |
| ISBN and metadata | ISBN_METADATA | HIGH | yes | same | none |
| Printing and quality | PRINTING_QUALITY | MEDIUM | yes | same | none |
| Distribution and availability | DISTRIBUTION_AVAILABILITY | MEDIUM | yes | same | none |
| Book status and production | BOOK_STATUS_PRODUCTION | MEDIUM | yes | same | none |
| General inquiry | GENERAL_INQUIRY | LOW | yes | same | none |

Each run used a fresh ticket; every attempt reached `COMPLETED` through the real classifier, grounding checks and persistence. Classification keys only on the author's text inside the untrusted blocks (not on policy excerpts), and citations are limited to chunks actually offered in the request (the real validator rejected the mock when it first cited an unoffered chunk).

## 3. Human review and delivery

* No AI output is sent automatically: after analysis the author's message count was unchanged and the author payload contained no analysis, rationale or draft (6/6 categories, API and UI).
* The admin clicks "Insert Draft into Reply Box", edits (the demo label line is removed), and sends. The author then sees only the sent text, without the label and without internal notes.
* The UI shows "Human Review Required" on the analysis card.

## 4. Failure handling and recovery

| Scenario | Evidence | Result |
| --- | --- | --- |
| Provider not configured | AI package + API tests (3), live earlier | `FAILED / AI_NOT_CONFIGURED`, no network call |
| Invalid provider output | tests (14, e.g. "both steps invalid -> FAILED/manual") | safe fallback, no fabricated output |
| Timeout / network error / 5xx | tests (2, 7); live with the mock stopped | `FAILED / AI_NETWORK_ERROR`, ticket intact and readable |
| Retry and backoff | tests (20) | bounded calls; `Retry-After` honoured |
| Cooldown | API test; live: a retry inside 30 s returns the existing attempt | enforced |
| Manual retry after recovery | live and isolated | `COMPLETED` |
| Duplicate / concurrent requests | tests (9); live: 6 parallel requests -> one attempt | single-flight |
| API restart / recreate / outage / mock crash | live (4 events) and isolated (recreate x3, startup, mock kill, database outage) | AI `COMPLETED` afterwards, mock started once per API start, no restart loop, 0 API restarts during a database outage |
| Prompt injection | AI security tests; E2E | hardened prompts, injection flags cap confidence |
| Invented figures | tests (3) | rationale replaced / draft rejected as `AI_UNGROUNDED_OUTPUT` |
| Privacy | E2E `9b` inspects exact provider bytes | no e-mail, phone, city, name, ISBN, internal note or financial field names |

An earlier design (separate container sharing the API's network namespace) failed these restart/recreate scenarios; see the release audit report and BUG register for the history. The in-container design replaced it.

## 5. Limits of this evidence

Mock output is canned and keyword-matched; it cannot reveal model hallucinations, tone problems, cost, latency or rate limits. The live host's actual provider requests were not captured (the mock logs no prompts by design); the privacy assertion rests on the E2E test, which passed on Linux Node 22 and 24. Draft quality for real tickets is untested.
