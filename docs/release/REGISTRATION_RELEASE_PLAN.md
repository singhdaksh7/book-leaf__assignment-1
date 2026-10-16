# Release plan: author self-registration, data hygiene tools, cleanup runbook

**Status: PREPARED, NOT DEPLOYED, NOTHING EXECUTED IN PRODUCTION.** Every step below needs the approval named in "Approval gates". The only production commands run while preparing this plan were read-only (`docker ps`, `SELECT`, `ls`, `cat`).

Baseline in production today: API `bookleaf-api:83184cd`, web `bookleaf-web:134f49b`, 5 migrations applied. Branch: `integration/bookleaf-fullstack` (not merged to `main`).

## 1. What this release contains

| Area | Change |
| --- | --- |
| API | `POST /auth/register`, registration rate limits (`REGISTER_LIMIT_PER_IP_PER_HOUR`, `REGISTER_LIMIT_GLOBAL_PER_HOUR`) |
| Contracts | `registerRequestSchema` (strict), `passwordPolicyIssues`, `registerResponseSchema` |
| Web | `/register` page, "Create account" link on the login page, empty-state wording for accounts without books, "Not provided" for empty phone/city in the admin author panel |
| `@bookleaf/db` | production guard on the synthetic seed; `cleanup:synthetic` (dry-run by default); `admin:ensure` |
| Database | **no schema change, no migration** |
| Docs | SDD (Markdown and PDF), ERD notes, OpenAPI, API reference, security, deployment, demo, acceptance, HR draft, this plan, the cleanup inventory, the admin procedure |

## 2. Database migration plan

**None required.** Registration writes the existing `User` and `AuthorProfile` columns: `externalAuthorId` = `WEB-` + 16 random hex characters (unique index already exists), `phone` and `city` = empty string, `joinedDate` = registration date. No column, index, constraint or trigger changes. `prisma migrate deploy` stays a no-op; confirm with `npm run migrate:status --workspace @bookleaf/db` (expect 5 applied, 0 pending). Because the schema is untouched, rolling the code back needs no database action.

Design note (why not nullable columns): making `phone`/`city` nullable would change the shared wire contract and every consumer for no functional gain; empty strings are rendered as "Not provided". Revisit if a profile editor is added.

## 3. Pre-deployment gates (all must be true)

1. Branch pushed; the SHA to deploy recorded; working tree clean.
2. Local results re-run on that SHA: typecheck, build, AI, API, web, scaffold, infra, E2E (see the final report for the recorded numbers).
3. VPS read-only check: `bookleaf-api`, `bookleaf-web`, `bookleaf-db` healthy; the other 13 containers recorded as a baseline (image id, start time, health).
4. Encrypted backup taken and verified, and an isolated restore proving the counts (`./scripts/backup.sh`, `BACKUP_PASSPHRASE_FILE=/root/.bookleaf-backup-pass ./scripts/restore-test.sh`).
5. Rollback anchors for the **currently running** images exist (`bookleaf-rollback-*`) and an offline tarball of `bookleaf-api:83184cd` and `bookleaf-web:134f49b` is saved (pattern from `DEPLOYMENT_RECORD.md`).
6. After 2026-10-17 only: real-AI and first-scheduled-backup verification recorded (Phase 6 below), otherwise the release goes out with those items still open and says so.

## 4. Deployment steps (not executed)

```bash
# Workstation, at the approved commit
T=$(git rev-parse --short HEAD)
git archive $T | (mkdir /tmp/bl-$T && tar -x -C /tmp/bl-$T) && cd /tmp/bl-$T
docker build -f infra/docker/api.Dockerfile -t bookleaf-api:$T . && docker build -f infra/docker/web.Dockerfile -t bookleaf-web:$T .
docker save bookleaf-api:$T bookleaf-web:$T | gzip | ssh root@77.37.45.177 'gunzip | docker load'
# confirm the image ids on the server equal the local ones before continuing

# Server
cd /opt/bookleaf/src/infra
cp -p .env .env.pre-registration-$T
sed -i "s/^BOOKLEAF_TAG=.*/BOOKLEAF_TAG=$T/; s/^BOOKLEAF_WEB_TAG=.*/BOOKLEAF_WEB_TAG=$T/" .env
# optional: REGISTER_LIMIT_PER_IP_PER_HOUR / REGISTER_LIMIT_GLOBAL_PER_HOUR (defaults 5 / 200 apply when absent)
docker compose up -d --no-build --no-deps api web      # db, Traefik and every other container untouched
```

Do **not**: change Traefik, run `migrate` (nothing to migrate), reboot, touch other projects, run the seed, or run the cleanup in the same step.

## 5. Rollback steps

```bash
cd /opt/bookleaf/src/infra
cp -p .env.pre-registration-$T .env && chmod 600 .env       # restores BOOKLEAF_TAG=83184cd, BOOKLEAF_WEB_TAG=134f49b
docker compose up -d --no-build --no-deps api web
# images missing? docker load < /opt/bookleaf/rollback/<tarball>
```

Accounts created through registration while the new release ran stay valid: they are ordinary `AUTHOR` users and can sign in with the old release (which simply has no sign-up page). No data is lost or needs converting.

## 6. Production verification plan (after the deployment, before anything else)

1. `docker ps`: api/web/db healthy, 0 restarts; neighbours identical to the baseline; `/healthz` 200.
2. Headers and TLS unchanged (HSTS, CSP, nosniff, frame deny, `no-store`).
3. `/register` loads (200, SPA), "Create account" visible on `/login`, no demo labels, mobile 375 px.
4. Register one clearly marked test author (for example `release-check+<date>@example.test`): `201`, lands on an empty dashboard, files a ticket, signs out and in again.
5. Negative checks against the live API: duplicate email `409` (generic text, no cookie); `role: "ADMIN"` body `400`; weak password `400`; foreign-origin request `403`. Run the rate-limit check **last** (the 6th attempt from one IP inside an hour answers `429`): every attempt above counts against the same 5-per-hour allowance, so the earlier checks must stay within it or be spread over time.
6. The new author gets `403` on `/admin/*`, `404` on a synthetic author's ticket id, and the admin still signs in and sees the new ticket in the queue.
7. Admin and author regression: existing `tests/live` scripts that do not depend on seeded demo data (login, ticket, attachment, SSE, dashboard counts, forms, mobile sweep).
8. Remove nothing yet. The release-check account and its one ticket are **not** on the cleanup whitelist, so the cleanup tool will never touch them: keep them as a clearly named smoke account, or remove them later with a separately approved, backed-up SQL statement.

## 7. Synthetic-data cleanup runbook (needs its own approval)

Inventory, classification and expected counts: [`FINAL_CLEANUP_INVENTORY.md`](FINAL_CLEANUP_INVENTORY.md). The tool needs the release above to be deployed (it ships in the API image).

```bash
# 1. backup + isolated restore (section 3, step 4); note the stamp, e.g. 20261016T054443Z
# 2. DRY RUN: changes nothing, prints counts, ids, attachment-file report and a confirmation token
docker exec -w /repo bookleaf-api npm run cleanup:synthetic --workspace @bookleaf/db
# 3. owner reviews the output and approves; then, with the token from step 2 and the backup stamp:
docker exec -w /repo bookleaf-api npm run cleanup:synthetic --workspace @bookleaf/db -- --execute --confirm <token> --backup-stamp <stamp>
```

Safety properties (each covered by an automated test): dry-run by default; only whitelisted synthetic identities whose external ids are also synthetic; the admin and any real author are never candidates; any unclassified record in scope blocks execution; execution re-plans in a Serializable transaction and aborts if the token differs; dependency order tickets, books, users; every table count and the admin id set are verified before commit and any mismatch rolls everything back; attachment files are removed only after the commit, by validated 48-hex key; the audit log is never deleted or rewritten (the database forbids it); one aggregate `maintenance.synthetic_cleanup` record (counts and the backup stamp, no text) is added.

Expected result on today's data: users 11 to 1, author profiles 10 to 0, books 18 to 0, tickets 150 to 0, messages 111 to 0, notes 25 to 0, assignments 31 to 0, AI attempts 211 to 0, attachment rows 44 to 0 and files 44 to 0, sessions 52 to 9, audit rows 223 to 224. (Counts will have moved if more activity happens first; the dry run is authoritative.)

After the cleanup: rotate the admin password ([`ADMIN_ACCOUNT.md`](ADMIN_ACCOUNT.md)), re-run the section 6 checks, and take a fresh backup.

## 8. Phase 6 follow-ups that are time-dependent (status at preparation: PENDING)

At preparation time the VPS clock read 2026-10-16 06:03 UTC, before both events.

| Check | Earliest time | Command or evidence |
| --- | --- | --- |
| Real-AI smoke (once, bounded, free model only) | 2026-10-17 00:00 UTC (quota reset) | one tiny probe with the key from `infra/.env`; stop and report BLOCKED on `free-models-per-day`; else `tests/live/real-ai-smoke.mjs` (about 12 calls) and the `AiAnalysis` query in `DEPLOYMENT_RECORD.md` (expect model `nvidia/nemotron-3-super-120b-a12b:free`, cost 0) |
| First scheduled backup | 2026-10-17 02:30 UTC | `tail /var/log/bookleaf-backup.log`; new `db-*.dump.enc`, `attachments-*.tgz.enc`, `SHA256SUMS-*`; `sha256sum -c`; `last-status.json`; `restore-test.sh`; retention and the 8 legacy plaintext files intact |
| Weekly restore test | 2026-10-19 03:30 UTC | log line from the cron job |

No credits are purchased and no paid model or mock substitutes for real inference; if the quota is still exhausted the result is recorded as BLOCKED.

## 9. Approval gates still open

1. Deploying the new API and web images.
2. Running the cleanup (a separate approval, after the owner has seen the dry run).
3. Rotating the admin password and optionally changing its email.
4. Merging to `main`.
5. Sending the HR email and granting reviewer repository access.
