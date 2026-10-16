# Final release acceptance report

**Status: READY WITH DISCLOSED LIMITATIONS (final re-verification 2026-10-16, see the last section).** The earlier PENDING markers below are historical; the last section supersedes them. The one open item is real AI on the live site, blocked by the provider's free daily quota until 2026-10-17 00:00 UTC.

## Release identity

| Item | Value |
| --- | --- |
| Live URL | https://bookleaf.77.37.45.177.sslip.io |
| Live API and database release | `83184cd` (images `bookleaf-api:83184cd`, id `06ab2d3eec21`) |
| Live web release | `134f49b` (`bookleaf-web:134f49b`, digest `sha256:d4d38f2dfbaee0a9da49e23312e6fd0f51d1af4c835cba9dcfa600d0755cbb98`) |
| Repository branch | `integration/bookleaf-fullstack`. The registration release is the HEAD of this branch at the commit that contains this file (see `git log`); it is **not deployed**. Runtime code in that release differs from the deployed images (API, web and `@bookleaf/db` tools) |
| `main` | untouched at `9366f16`; not merged |
| AI provider and model | OpenRouter, `nvidia/nemotron-3-super-120b-a12b:free`; mock disabled; no paid fallback possible (non-`:free` ids are rejected before any request) |

## Acceptance matrix

| Area | Result | Evidence |
| --- | --- | --- |
| Unit and integration tests (mock AI) | PASS (local, registration release) | AI 485, API 292 (0 skipped), web 68, scaffold 9, infra 12; typecheck and build clean |
| Browser E2E on a disposable stack | PASS (local) | 41/41, including 11 registration tests (desktop, 375 px mobile, keyboard-only) |
| Author self-registration, security controls, admin untouchable | PASS (local) | strict body rejects `role`; role fixed server-side; Argon2id; policy; concurrent duplicates yield one winner; rate limits; admin routes denied; admin and seeded-author login regression |
| **Registration live on the deployed site** | **PENDING** | needs the owner's approval to deploy new API and web images (`docs/release/REGISTRATION_RELEASE_PLAN.md` sections 4 to 6). Observed result: _to be filled in_ |
| Synthetic-data cleanup tool | PASS (local) | 20 automated tests plus a rehearsal in the real API image against a throwaway database: dry run changes nothing, wrong token refused, execute keeps admin and a real author, audit log intact |
| **Cleanup executed on production** | **PENDING** | production inventory is in `docs/release/FINAL_CLEANUP_INVENTORY.md` (11 users, 150 tickets, 44 attachments, 223 audit rows, all synthetic); needs a verified backup and the owner's separate approval after the dry run. Observed result: _to be filled in_ |
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
5. Not implemented: password reset, e-mail notifications, e-mail verification of new accounts, attachment deletion, server-side search.
   Registration reveals whether an address is registered; self-registered authors start with no books and there is no screen to link books yet.
6. Older synthetic tickets from the mock era keep stored `[DEMO MOCK]` analysis text.
7. Real-model draft quality is probabilistic: roughly one draft in ten may be rejected by strict grounding and shown as a labelled rule-based fallback.

## Sign-off checklist (complete after 2026-10-17)

- [ ] Registration release deployed with approval and verified live (section 6 of the release plan), including the negative checks
- [ ] Production cleanup dry run shown to the owner, separately approved, executed, counts verified, fresh backup taken, admin password rotated
- [ ] Live real-AI smoke test passed once (model `nvidia/nemotron-3-super-120b-a12b:free`, cost 0, no mock, human approval required) or recorded as BLOCKED with the reason
- [ ] First scheduled backup verified (cron log, new encrypted set, checksums, retention intact, isolated restore, anchors intact, neighbours unchanged)
- [ ] Remote HEAD and deployed images recorded in the final version of this report

## Final status 2026-10-16 (supersedes any PENDING item above)

* **Deployed:** API `bookleaf-api:3eb1aff`, web `12edd72`; rollback image `12edd72` retained; verified backups `20261016T080326Z` and `20261016T081004Z` taken before the release and the dataset import.
* **Dataset:** the assignment's 10 authors and 18 books are imported alongside the older synthetic records (nothing deleted): 358 field comparisons, 0 mismatches; 10/10 logins; My Books counts and ids exact; cross-author read 404.
* **Admin/author workflow (live):** admin reply visible to the author after the explicit send, internal note hidden, status updated.
* **Real AI:** verified locally on the final code (classification/priority 6/6, model drafts 5/6, cost $0). **Live: quota-blocked** (`AI_RATE_LIMITED` for six analyses on 2026-10-16); no successful live inference is claimed.
* **Not done (by decision):** synthetic-data cleanup, admin password rotation, merge to `main`.

## Final re-verification 2026-10-16 (evidence from this pass, supersedes everything above)

* **Dataset parity:** production `AuthorProfile`/`User`/`Book` rows compared with the original JSON field by field: 10 authors, 18 books, 358 comparisons (author fields, role, book-to-author link, every book field), 0 mismatches. Source royalties reconcile (earned = paid + pending = copies x per-copy). Statuses: 16 Published & Live, 1 In Production - Cover Design, 1 In Production - Typesetting. Production holds 36 books in total (18 original + 18 older synthetic).
* **Logins and isolation (live):** 10/10 original authors log in, each sees exactly their own `BK` ids, cross-author book read 404, authors get 401/403 on the admin API, admin login and queue (169 tickets) work, wrong password 401, foreign Origin rejected: 45/45 checks.
* **Ticket flow (live):** a newly self-registered author (starts with 0 books) created a ticket; admin added an internal note, overrode status/category/priority, replied; the author received the reply and the new status; the internal note was not visible to the author; author blocked from the admin API: 13/13.
* **Automated:** typecheck clean; build clean; AI 509, API 292, web 68, infra 12, scaffold 9 passed; Playwright E2E 41/41 (Chrome via `E2E_CHROMIUM_PATH`; the first attempt failed only because Playwright's own Chromium was not installed on this machine).
* **Bundle and headers:** the served JS bundle is identical to the local build; it contains no key or OpenRouter variable names; HSTS, CSP, nosniff and frame-deny headers present; HTTP redirects to HTTPS.
* **Backup and rollback:** fresh encrypted backup `20261016T095733Z` taken after the import and restored in an isolated container (12 tables; users 24, authors 23, books 36, tickets 169, attachments 50; matches live). Attachments: 50 rows, 50 files on the volume. Rollback image `bookleaf-api:12edd72` present. All 16 containers still running; no other project touched.
* **AI quota:** the OpenRouter `/key` endpoint reports `free_model_daily_requests` 62 used of 50 (0 remaining), account credits 0. No inference calls were made in this pass. Live AI remains **BLOCKED**, not passed. Procedure: `docs/release/API_KEY_ROTATION.md`.
* **Not done by decision:** synthetic-data cleanup (inventory: `docs/release/CLEANUP_INVENTORY_2026-10-16.md`), admin password rotation, merge to `main`, off-host backup.

## Final release addendum (2026-10-16, after owner approval)

* **Repository** `singhdaksh7/book-leaf__assignment-1` is now PRIVATE (anonymous requests return 404). It had been public until then; a history audit found no credentials, backups, `.env` files, original dataset or assignment PDF in any commit. One placeholder-style phone number that equals AUTH001's number in the dataset appears in a redaction unit test (`packages/ai/tests/security.test.ts`) since an early commit; history was not rewritten.
* **Dedicated reviewer admin** created through the server admin tool after a fresh encrypted backup (`20261016T101230Z`); the original admin is unchanged. Live checks 17/17: login, queue, stored AI analysis and draft visible, category/priority/status override, internal note, reply sent and received by the author, internal note hidden, original admin still logs in. The application has one staff role (ADMIN), so there is nothing narrower to grant.
* No OpenRouter requests were made; no synthetic data deleted; no admin password rotated.
