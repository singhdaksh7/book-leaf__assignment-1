# Deployment record: registration release `12edd72` (2026-10-16)

Approved by the owner for commit `12edd728a82416e9c4f8ee16a9c26fb261ba7418`, deployed following `REGISTRATION_RELEASE_PLAN.md`. **Verdict: DEPLOYED AND HEALTHY; registration verified live. Cleanup NOT executed (dry run only). Real AI still BLOCKED/pending; first scheduled backup still pending.**

| Item | Value |
| --- | --- |
| API image | `bookleaf-api:12edd72`, id `a70acdc10c57` (container `23dc82357bcb`), built from `git archive 12edd72`; id on the server equals the local build |
| Web image | `bookleaf-web:12edd72`, id `e04967e04088` (container `6adfd3fea263`) |
| Recreated | `bookleaf-api`, `bookleaf-web` only (`--no-build --no-deps`), 2026-10-16 07:02 UTC. `bookleaf-db`, Traefik and the 13 other containers untouched |
| Not done | no migration (5 applied = 5 in the repo), no cleanup, no admin credential change, no OpenRouter setting change, no reboot, no merge to `main` |
| Config change | `BOOKLEAF_TAG` and `BOOKLEAF_WEB_TAG` set to `12edd72` in the server `.env` (mode 600); registration limits use the defaults (5 per IP per hour, 200 overall) |

## Pre-deployment gates

* Remote `integration/bookleaf-fullstack` = local = `12edd72`; tree clean; exact search of tracked files for key/private-key patterns: 0 hits.
* Tests on that commit: typecheck 0 errors, build ok, AI 485, API 292, web 68, scaffold 9, infra 12, Playwright 41, all passed.
* Containers healthy; disk 32% used (33 GB free); 13 neighbours recorded as a baseline.
* **Rollback protection:** new stopped anchors `bookleaf-rollback-api-06ab2d3eec21` (`bookleaf-api:83184cd`) and `bookleaf-rollback-web-d4d38f2dfbae` (`bookleaf-web:134f49b`) added to the 5 existing anchors; offline tarball `/opt/bookleaf/rollback/pre-registration-20261016.tar.gz` (`gzip -t` ok, sha256 `339a9c28…0318`); `.env.pre-registration-12edd72` and `docker-compose.yml.pre-registration-12edd72` saved.
* **Backup:** encrypted set `20261016T064747Z`, verified by the script, checksums OK; **isolated restore** into a disposable internal-network container reproduced AuditLog 223, AuthorProfile 10, Book 18, InternalNote 25, Session 52, Ticket 150, TicketAssignment 31, TicketAttachment 44, TicketMessage 111, User 11, migrations 5; the container and network were removed. Off-host copy still does not exist.

## Rollback (exact; nothing to undo in the database)

```bash
cd /opt/bookleaf/src/infra
cp -p .env.pre-registration-12edd72 .env && chmod 600 .env     # BOOKLEAF_TAG=83184cd, BOOKLEAF_WEB_TAG=134f49b
docker compose up -d --no-build --no-deps api web
# images missing? docker load < /opt/bookleaf/rollback/pre-registration-20261016.tar.gz
```

Accounts registered while the new release runs remain valid under the old one.

## Neighbours

After deployment the 13 other containers (daxul_labs, kp, printout, traefik, vastraa, including two long-exited one-shot migrate jobs) match the baseline exactly in image, id, creation time and health; the only differences in the full list are the two rollback anchors added above.

## Live verification (https://bookleaf.77.37.45.177.sslip.io)

Clearly named synthetic QA accounts were used and nothing was deleted: `qa.registration.1792134250468@example.test`, `qa.mobile.1792134250468@example.test`, `qa.uirecheck.1792134277272@example.test`; QA tickets `cmvamgxyn0007p801oyydd09t`, `cmvamhi2j0018p801qha68wcb`.

| # | Check | Result |
| --- | --- | --- |
| 1 | Login page shows Create account | PASS |
| 2 | `/register` loads; no demo labels on the auth pages | PASS |
| 3 | New author registers, lands on the dashboard; role AUTHOR, `WEB-` id, empty phone/city | PASS |
| 4 | Duplicate email: 409, generic text, no cookie | PASS |
| 5 | `role: ADMIN` payload: 400; no account created | PASS |
| 6 | Existing admin signs in | PASS |
| 7 | Empty dashboard, books and tickets pages (no inherited data) | PASS (see note) |
| 8 | General ticket created via the UI | PASS (see note) |
| 9 | Admin sees the ticket, assigns, sets IN_PROGRESS, adds a note, replies; author sees the reply but not the note | PASS |
| 10 | Author: Access Restricted in the UI, 403 on `/admin` APIs, 404 on another author's ticket | PASS (see note) |
| 11 | Logout ends the session; the new author signs in again (email case-insensitive) | PASS |
| 12 | 375 px mobile: no overflow; keyboard-only registration incl. the show/hide control | PASS |
| 13 | 27 captured API responses: no hashes, tokens, keys or stack traces | PASS |
| + | Rate limit: the 6th attempt inside the hour answers 429 with `Retry-After`, no account | PASS |

Note: in the first run, UI checks 7, 8 and 10 failed because my script read the page before it had loaded (the admin had already seen the ticket, so it existed). The same checks were repeated with proper waits on a fresh QA account and passed 5/5. This used the 5th of 5 allowed registration attempts, so further registration from the test IP answered 429 with Retry-After 3240 s (the window clears about an hour after the first attempt); this is the limiter working as designed.

## Regression on the deployed site (OpenRouter not called by these scripts for any reason other than the automatic background analysis of new tickets, which the exhausted free quota rejects)

API matrix 139/139 (BUG-001 FIXED, BUG-002 known); audit 49/49; closed-ticket rules all pass; dashboard counts 7/7; UI journey 16/16 (AI panel: `AI analysis failed (AI_RATE_LIMITED)`); UI forms 21/21; SSE 5/5 (delivery about 100 ms); mobile sweep 55 viewport checks clean; failure-notice 10/10.

Real AI on the live site: **BLOCKED** (free daily quota exhausted until 2026-10-17 00:00 UTC); no model request was made by hand and nothing mock or paid was substituted.
