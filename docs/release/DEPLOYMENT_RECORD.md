# Deployment record: release `83184cd` (2026-10-16)

Executed under the owner's conditional approval, following `DEPLOYMENT_PLAN.md` with each command checked first. **Verdict: DEPLOYED AND HEALTHY; real AI on the live site NOT YET VERIFIED** because the OpenRouter free daily quota (50 requests) was exhausted. Every other acceptance check passed.

## What is live

| Item | Value |
| --- | --- |
| Git SHA (branch `integration/bookleaf-fullstack`) | `83184cd008c9784871bf5bf9cb407e4d9d7a60f8` (remote = local at deploy time; tree clean) |
| API image | `bookleaf-api:83184cd` (id `06ab2d3eec21`), built locally from `git archive 83184cd`, loaded with `docker load` (id matched the local build) |
| Web image | `bookleaf-web:83184cd` (id `5306ef3f2112`) |
| Services recreated | `bookleaf-api` (05:18:19Z), `bookleaf-web` (05:18:44Z), using `--no-build --no-deps`. `bookleaf-db` not touched (started 2026-10-15) |
| Not done | no migration, no Traefik change, no reboot, no host upgrade, no cron change, no neighbour restart, Aadya untouched, no merge to `main` |
| Provider | OpenRouter `https://openrouter.ai/api/v1`; model `nvidia/nemotron-3-super-120b-a12b:free` (re-verified immediately before: price 0/0, `response_format` and `structured_outputs` supported, uptime 100%) |
| Demo mock | **Disabled**: `MOCK_AI_ACK` unset in the running container; the demo override file is not used |

## Configuration changes (server `infra/.env`, mode 600, never printed or copied whole)

* Added `OPENROUTER_API_KEY` (was empty). Streamed through stdin into a mode-600 temporary file, merged, shredded.
* **Removed `OPENROUTER_MODEL=openai/gpt-4o-mini`**: a paid model pinned in the server file, which the zero-spend guard would have rejected. The code default (Nemotron) now applies. `OPENROUTER_BASE_URL` is absent.
* Set `BOOKLEAF_TAG` and `BOOKLEAF_WEB_TAG` to `83184cd`.
* `docker-compose.yml` replaced by the release file (the only difference from the old one was the default-model line).
* The local `infra/.env` (which pins Gemma) was not copied.

## Safety gates

| Gate | Result |
| --- | --- |
| Pre-checks | remote = local = `83184cd`; clean tree; no tracked secrets (exact key search: 0); no migrations since `ba35295`; Nemotron available at price 0; 34 GB disk free; BookLeaf containers healthy; 15 neighbouring containers recorded as a baseline |
| Rollback protection | four stopped, labelled anchor containers (`bookleaf-rollback-*`) reference the four BookLeaf images (`6cb5ef4a6d59` api; `6dc217f8d8db`, `cea25dbcd83a`, `8f4fce4721ac` web), so the host prune rule ("unused images older than 24 h") cannot select them; offline tarball `/opt/bookleaf/rollback/pre-83184cd-20261016.tar.gz` (230 MB, `gzip -t` ok, sha256 `3e75d118…4f0e`) also copied to the owner's workstation. The host cron was not modified; anchors, images and cron re-checked after deployment |
| Backup | encrypted (AES-256, PBKDF2) database and attachment backup `20261016T050116Z`; verification inside the script passed; **isolated restore** into a disposable container reproduced 119 tickets, 25 attachments, 122 AI attempts, 11 users (matching the live counts); disposable container and network removed; live database unchanged; legacy plaintext backups untouched (8 files) |

## Rollback (exact, stored at `/opt/bookleaf/rollback/ROLLBACK-COMMANDS-83184cd.txt`)

```bash
cd /opt/bookleaf/src/infra
cp -p .env.pre-release-83184cd .env && chmod 600 .env
cp -p docker-compose.yml.pre-release-83184cd docker-compose.yml
docker compose -f docker-compose.yml -f docker-compose.demo.yml up -d --no-build --no-deps api
docker compose up -d --no-build --no-deps web
# images missing? docker load < /opt/bookleaf/rollback/pre-83184cd-20261016.tar.gz
```

This restores the previous demo-mock staging state. Rollback was **not** needed: no critical regression occurred, and provider quota exhaustion alone is not a rollback condition.

## Live acceptance (https://bookleaf.77.37.45.177.sslip.io)

| Area | Result |
| --- | --- |
| HTTPS, headers | 200; Let's Encrypt (valid to 2027-01-13); HSTS, CSP, nosniff, frame deny; `no-store` on API responses; http redirects 301 to https |
| Author and admin login, logout, session cookie flags | passed (HttpOnly + Secure; session invalid after logout) |
| Ticket creation, attachment upload and byte-identical admin download, assignment, internal note (hidden from author), status change, admin send, author receives it | passed (`tests/live/real-ai-smoke.mjs`) |
| SSE | 5/5 browser realtime checks; live `ticket.created/updated/reply.created` events received |
| Dashboard counts, persistence | 7/7; count increased by exactly the tickets created |
| API matrix | 139/139 (one known issue, BUG-002 duplicate concurrent tickets, unchanged; BUG-001 whitespace login now reported **FIXED live**) |
| Closed-ticket rules | all passed |
| Security/audit script | 45/47: `IN_PROGRESS->OPEN` is the documented wrong assumption (the code allows it on purpose); `status=OPEN` filter check assumes the new ticket is on page 1 of 123 open tickets (the filter itself was verified directly: all items OPEN, total correct) |
| Mobile and responsive | 55 checks (5 viewports x 11 pages, both roles): no overflow, console errors, failed requests or broken text |
| UI forms | 21/21 |
| UI journey | 13/16: the 3 failures are the AI-panel steps, which that script ties to demo-labelled drafts and which cannot pass while no AI draft exists |

## Real AI on the live site: BLOCKED by provider quota

* Every analysis during acceptance was recorded `FAILED` with `AI_RATE_LIMITED` (62 attempts in the database since the smoke test began, cost 0, model never reached). The direct provider probe said `Rate limit exceeded: free-models-per-day`, limit 50, remaining 0, reset 2026-10-17T00:00:00Z. Account usage stays 0.
* No mock or paid model was substituted. The application stayed healthy and tickets, replies, attachments and review all worked manually.
* **Pre-deployment real evidence stands** (local runs against the same code and model): classification 6/6, drafts accepted 12/13, see `AI_REAL_PROVIDER.md`.
* **To complete verification** after the reset: `BL_AUTHOR_PW=... BL_ADMIN_PW=... node tests/live/real-ai-smoke.mjs` (about 12 calls, synthetic tickets), then query `"AiAnalysis"` for `model` and `costMicrounits` (the API does not expose them). The earlier tests used the same key and exhausted the day's quota, so repeated test runs on a free key will hit this again.
* **Capacity implication:** a key without purchased credits allows 50 requests a day, about 25 ticket analyses. Real use above that needs the owner to decide on credits (documented by OpenRouter: 10 credits raise the free-model limit to 1 000/day). No billing change was made.

## Scheduled backups

Installed `/etc/cron.d/bookleaf-backup` (root, 644; the reviewed example unchanged): daily backup 02:30 UTC and a weekly isolated restore test Monday 03:30 UTC, logging to `/var/log/bookleaf-backup.log` (mode 600). Passphrase `/root/.bookleaf-backup-pass` (mode 600) with a copy on the owner's workstation outside the repository and OneDrive. Retention 7 daily / 4 weekly / 3 monthly applies only to encrypted sets inside `infra/backups/{daily,weekly,monthly}`. Monitoring: `backups/last-status.json` (`status`, `time`, `offHost`) and the log; there is no alert webhook yet.

**Not yet observed:** the first scheduled run (02:30 UTC tonight). **Off-host storage is not configured**, so backups are local-only on the same disk (a copy of the first set is on the owner's workstation): disaster recovery is INCOMPLETE. No external storage was configured or purchased.

## Container health and neighbours

After deployment: `bookleaf-api`, `bookleaf-web`, `bookleaf-db` healthy, 0 restarts, `/healthz` 200, no application errors in the log except the recorded AI rate limits. The 15 other containers (daxul_labs, kp, printout, traefik, vastraa, including two long-exited one-shot migrate jobs) match the pre-deployment baseline exactly in image id, start time, health and state. Disk 32% used.

## Post-deployment follow-up (2026-10-16, same day)

* **Pushed:** `e5df2e8` is the remote `integration/bookleaf-fullstack` head (normal fast-forward from `83184cd`; `main` untouched at `9366f16`).
* **Live-test assertions corrected** (commit `fe463aa`, local until pushed):
  * *Reopening:* `IN_PROGRESS -> OPEN` is allowed by design (only `CLOSED` is terminal; `docs/architecture/08-TICKET-LIFECYCLE.md`). The audit script asserted the opposite. It now asserts the reopen succeeds, returns to `IN_PROGRESS`, and that an unknown status value is rejected with 400; CLOSED terminality stays covered by `closed.mjs`.
  * *Queue visibility:* the open queue has more than one page and its ordering is intentional, so a new ticket need not be on page 1. The script now walks the pages and still requires every item to be `OPEN` and the new ticket to be present.
  * *UI journey:* the three AI-panel steps expected demo labels. They now accept either a real draft or an honest failed state, forbid any `[DEMO MOCK/DRAFT]` text unless `EXPECT_DEMO=1`, and still require human review, explicit send, no automatic message, and no AI or internal content visible to the author.
  * Re-run against the live site: audit **49/49**, UI journey **16/16** (AI panel state recorded as `failed`, because the quota is exhausted).
* **Defect found by that run (fixed locally, not deployed):** the deployed admin UI renders a FAILED AI attempt as "No AI analysis record generated yet for this ticket", indistinguishable from no attempt. Commit `f77e628` adds an `AiFailureNotice` (error code, plain reason, "no draft was generated and nothing was sent") with 3 tests (web suite 53 passing, typecheck clean). **It needs a new web image and your approval to deploy.**
* **Pending, time-dependent verification:** (a) real AI on the live site after the quota resets at 2026-10-17T00:00Z; (b) the first scheduled backup at 2026-10-17T02:30Z. Follow-up checks are scheduled for 05:42 IST and 08:12 IST on 2026-10-17 (session-only schedules); if the session is closed they must be run by hand with the commands in this record and `BACKUP_AND_RECOVERY.md`.

## Remaining limitations

Real AI on the live site unverified (quota); free tier capacity about 25 analyses a day; no off-host backup; first scheduled backup not yet observed; pending host reboot and updates (not touched); host prune cron unchanged (rollback images protected by anchors, not by changing the cron); `/opt/bookleaf/src` is still not a git checkout (the release files were installed individually); duplicate-ticket race (BUG-002), page-local admin search and the trigger gap remain deferred.
