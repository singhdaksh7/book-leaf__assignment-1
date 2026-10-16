# Final release acceptance report

**Status: DRAFT. Two acceptance checks are pending (marked PENDING) and depend on events on 2026-10-17: the OpenRouter free daily quota reset (00:00 UTC) and the first scheduled backup (02:30 UTC). Do not treat this as final until both rows are filled in with observed results.**

## Release identity

| Item | Value |
| --- | --- |
| Live URL | https://bookleaf.77.37.45.177.sslip.io |
| Live API and database release | `83184cd` (images `bookleaf-api:83184cd`, id `06ab2d3eec21`) |
| Live web release | `134f49b` (`bookleaf-web:134f49b`, digest `sha256:d4d38f2dfbaee0a9da49e23312e6fd0f51d1af4c835cba9dcfa600d0755cbb98`) |
| Repository branch | `integration/bookleaf-fullstack`, remote HEAD `c0ad679` at the time of writing (documentation and verification scripts after `134f49b`; no runtime code differs from the deployed images) |
| `main` | untouched at `9366f16`; not merged |
| AI provider and model | OpenRouter, `nvidia/nemotron-3-super-120b-a12b:free`; mock disabled; no paid fallback possible (non-`:free` ids are rejected before any request) |

## Acceptance matrix

| Area | Result | Evidence |
| --- | --- | --- |
| Unit and integration tests (mock AI) | PASS | AI 485, API 230 (0 skipped), web 53, scaffold 9, infra 12; typecheck and build clean |
| Browser E2E on a disposable stack | PASS | 30/30 |
| Deployment safety gates | PASS | rollback anchors and offline tarballs; encrypted backup restored in isolation with matching counts; neighbours (15 containers) identical before and after both deployments; API and DB untouched by the web hotfix |
| Live HTTPS, headers, login, tickets, attachments, assignment, notes, admin send, author receipt | PASS | `real-ai-smoke.mjs` platform checks; headers verified (HSTS, CSP, nosniff, frame deny, no-store) |
| Live API matrix | PASS | 139/139 (BUG-001 fixed on the live site; BUG-002 duplicate concurrent ticket remains a known deferred issue) |
| Live audit, UI journey, forms, SSE, dashboard totals, mobile sweep | PASS | 49/49, 16/16, 21/21, 5/5, 7/7, 55 viewport checks clean |
| Live AI failure visibility | PASS | failed attempts show `AI analysis failed (AI_RATE_LIMITED)` and the reason; 10/10 checks; no key or provider text leaked; no demo labels on new attempts |
| Real AI, local runs on the final code | PASS WITH LIMITS | classification 6/6 in every run; drafts accepted by strict grounding in 12 of 13 analyses; reported cost 0; account usage 0 |
| Real AI failure handling against the real endpoint | PASS | rejected key (1 request, no retry), nonexistent model, paid primary/fallback blocked with 0 requests, real 429 recorded without substitution |
| **Real AI on the live site (Nemotron, cost 0, grounded draft, human approval, no mock)** | **PENDING** | blocked on 2026-10-16 by `free-models-per-day` (50 requests); to be run once after 2026-10-17T00:00Z. Observed result: _to be filled in_ |
| **First scheduled encrypted backup, checksums, retention, isolated restore** | **PENDING** | daily cron installed; first run due 2026-10-17T02:30Z. Observed result: _to be filled in_ |

## Security and privacy summary

Server-side sessions with HttpOnly, Secure, SameSite cookies; CSRF tokens; origin checks; Argon2id; role and ownership checks (a foreign ticket answers 404 exactly like a missing one); rate limits; strict input validation; forced-download attachments; secrets only in a mode-600 server environment file (the OpenRouter key, database password and demo passwords are not in the repository or any commit; an exact-value search confirmed this); AI output is untrusted and validated; the AI never sends. Free AI endpoints may retain prompts: only synthetic data was used and prompts are minimised.

## Known limitations (see `KNOWN_LIMITATIONS.md`)

1. Free tier capacity: about 25 AI analyses per day; above that the portal shows a rate-limit notice and replies are manual. Raising it means buying credits, which is the owner's decision.
2. No off-host backup, so disaster recovery is incomplete; no backup-failure alert; single host and disk.
3. Host items outside this project: pending reboot and security updates; a host cron that prunes unused images (rollback images are protected by anchor containers, not by changing the cron); `/opt/bookleaf/src` is not a git checkout.
4. Deferred defects: duplicate tickets on concurrent identical submissions; admin search covers the current page only; liveness-only health check; internal-note and assignment deletion not trigger-protected (needs a migration).
5. Not implemented: password reset, e-mail notifications, attachment deletion, server-side search.
6. Older synthetic tickets from the mock era keep stored `[DEMO MOCK]` analysis text.
7. Real-model draft quality is probabilistic: roughly one draft in ten may be rejected by strict grounding and shown as a labelled rule-based fallback.

## Sign-off checklist (complete after 2026-10-17)

- [ ] Live real-AI smoke test passed once (model `nvidia/nemotron-3-super-120b-a12b:free`, cost 0, no mock, human approval required) or recorded as BLOCKED with the reason
- [ ] First scheduled backup verified (cron log, new encrypted set, checksums, retention intact, isolated restore, anchors intact, neighbours unchanged)
- [ ] Remote HEAD and deployed images recorded in the final version of this report
