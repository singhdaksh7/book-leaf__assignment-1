# BookLeaf release audit report (final)

Audit date: 2026-10-15. Auditor: Claude (QA / security / DevOps review). Everything below was observed in this session; anything
not performed is listed under "Not verified". No secret values appear in this report.

## 1. Revisions

| Item | Value |
| --- | --- |
| First audited SHA | `3b09980` (six final commits) |
| Reliability-fix commits | `22a7db0` fix(infra): run demo AI inside the API container so it survives API restarts; `e16a25e` docs: correct deployment runbook, document demo-AI design, add reviewer access |
| This report | committed on top of `e16a25e` (see the branch head; the report cannot contain its own hash) |
| Tested tree | the exact file set of `e16a25e` (plus the earlier draft of this report), exported and run in clean Linux containers |
| Deployed | `bookleaf-api:localtest` (compiled output identical to a clean build, verified at `3b09980`; API source unchanged since), `bookleaf-web:loginfix-20261015`, plus the compose files and `infra/mock-ai/` from `e16a25e` (hash-verified identical to the commit) |

## 2. GitHub verification

- Pushed with a normal (non-force) push; remote `integration/bookleaf-fullstack` = local = `e16a25e` at push time. `main` unchanged at `9366f16` on the remote.
- No `.env`, dataset, backups, dumps, build output or reports tracked. Secret scan of the pending files: clean. `git diff --check`: clean.
- `docs/architecture/` is an **untracked** documentation tree written by another process during this work; it was not reviewed in depth, not committed and not modified (see finding D-1).

## 3. The defect and how it was fixed

**S-1 (was MEDIUM, now FIXED and verified live).** The staging demo AI mock ran as a separate container sharing the API's network
namespace. It silently stopped working whenever the API was restarted or recreated.

What testing showed, in order:

1. `docker restart bookleaf-api`: the API moves to a new namespace, the mock is stranded in the old one (`ECONNREFUSED`,
   `AI_NETWORK_ERROR`) while still reporting healthy. A watchdog (mock exits when the API port disappears) fixed this case.
2. **Recreate** (`up --force-recreate`, `--no-deps`, or an image/env change): the mock stays `exited` permanently with
   `joining network namespace of container: No such container: <old id>` because its network mode is pinned to the deleted container.
   The watchdog cannot help, and Compose `depends_on: { condition: service_healthy, restart: true }` did not restart it either
   (reproduced for `--no-deps` and for a recreate with dependencies). The first fix was therefore **insufficient** and was not deployed.
3. Redesign: `infra/docker-compose.demo.yml` (opt-in override) runs the mock as a supervised background process **inside the API
   container** (`while true; do node /mock-ai/server.mjs; sleep 2; done & exec node dist/server.js`; the API remains PID 1). It binds
   `127.0.0.1:8080` only, still requires `MOCK_AI_ACK=demonstration-only`, and the override itself sets the dummy key, model and
   loopback URL, so a real key can never be combined with the mock. The base compose file has no mock service and no demo values.
   Trade-off: the mock shares the API container's user, memory limit and writable filesystem (its code is mounted read-only); it is no
   longer a separate read-only container.

Local scenario matrix on the new design (mock never touched manually), all ending with a real AI call `COMPLETED`: force-recreate
`--no-deps`; force-recreate with dependencies; `docker restart`; `docker compose restart`; env-change plain `up -d`; mock process
killed; API stopped 25 s then started; container removed and cold-created; two genuine crash-restarts (API process exits, restart
policy revives it). Plain `docker kill` is not a valid crash simulation (Docker treats it as a manual stop and skips the restart policy).

## 4. Automated test matrix (final tree, clean Linux containers)

| Check | Node 22.23.3 | Node 24.22.0 |
| --- | --- | --- |
| Typecheck (all workspaces) + e2e project | pass | pass |
| Production build | pass | pass |
| AI package | 456 passed, 0 failed, 0 skipped | 456 / 0 / 0 |
| API with real `@bookleaf/ai` (absolute `BOOKLEAF_AI_ENTRY`) | 227 passed, 0 failed, 0 skipped | 227 / 0 / 0 |
| Web unit tests | 46 passed | 46 passed |
| Scaffold | 9 passed | pass (exit 0) |
| `npm run test:infra` (mock: ack required, own-port loopback binding, 6 categories x classify+draft, demo labels, offered-only citations, no money, no prompt echo, 404/400) | 12 passed, 0 failed | pass (exit 0; count not shown by my output filter) |
| Playwright E2E, Chromium on Linux | 30 passed | 30 passed |
| Compose validation | base and base+demo+tools valid; base services `db api web`; 0 published ports; base API env contains no mock/dummy values | n/a |
| `git diff --check` | clean | n/a |

## 5. Deployment performed

Only the BookLeaf API container was recreated; DB and web were not restarted (uptime ~5 h). Steps: health snapshot; fresh backup
(`db-20261015T113228Z.dump`, 53,774 B, 111 TOC entries; attachments archive 627 B); previous implementation preserved
(`docker-compose.yml.pre-incontainer`, `mock-ai.pre-incontainer/`, `.env.pre-incontainer`, image tag `bookleaf-api:pre-mockai`);
shipped `docker-compose.yml`, `docker-compose.demo.yml`, `mock-ai/server.mjs`, `server.test.mjs`, `DEPLOY.md`, `.env.example` (hashes match
the commit); server `.env` AI values reset to "not configured" (`OPENROUTER_API_KEY=` empty, default model, no base URL) so the demo is
controlled solely by the override; dry-run confirmed only `bookleaf-api` would change; removed the old BookLeaf-owned sidecar
container `bookleaf-mock-ai`; recreated the API with the override. Traefik, other applications and the dummy key semantics were not touched.

## 6. Critical live recovery test (public HTTPS URL; the mock was never touched manually)

| Event | API container before / after | AI after (classify + draft, labels) | Mock starts since API start | Separate mock containers / published ports |
| --- | --- | --- | --- | --- |
| 1. `up --no-deps --force-recreate api` | `d6e5dc55` / `053125fb` | `COMPLETED`, ROYALTY_PAYMENTS, `[DEMO MOCK]` + `[DEMO DRAFT]` | 1 | 0 / none |
| 2. `up --force-recreate api` (deps allowed), probe issued while the API was still starting | `053125fb` / `09fa6f8d` | same | 1 | 0 / none |
| 3. `docker restart bookleaf-api` | `09fa6f8d` (same id) | same | 1 | 0 / none |
| 4. API stopped 25 s, then started | `09fa6f8d` (same id) | same | 1 | 0 / none |

Every event also had a baseline AI call that succeeded first. "Mock starts = 1" per API start shows there is no restart loop. During each AI
call the API container's established TCP peers were only `127.0.0.1` and `172.16.9.2` (the PostgreSQL container): no external address.
From outside the VPS, ports 8080, 3000, 5432, 3100 and 6379 are unreachable. API logs contain 0 mentions of an OpenRouter host and 0 AI attempts failed in the
last 10 minutes. The key on staging is a dummy value; real OpenRouter inference was **not** tested.

## 7. Live regression after deployment (synthetic accounts)

| Suite | Result |
| --- | --- |
| AI: six categories classify + draft, labels, no amounts, never auto-sent, admin edits and sends, author receives only the sent text | 34/34 |
| API/security regression | 29/30; see note A |
| Extended audit (ownership, uploads incl. traversal, queue filters, headers, sessions, SSE, XSS, polling fallback) | 46/47; see note B |
| Closed-ticket rules + real cookie lifetime (168 h) | 7/7 |
| Login throttling (11th failure on one account: 429, `Retry-After: 900`; stays blocked; other accounts unaffected) | 4/4 |
| Browser auth (empty fields, wrong password, login, reload, logout, role routes) | 19/19 |
| Full UI journey (create ticket + attachment, download, reply, queue, assign, status, note, AI panel, edited reply, admin download, role block, logout) | 16/16; see note A |

- Note A: the check "new ticket appears in the admin queue" failed on page 1 only because of ordering, not a defect. Unresolved tickets sort by
  priority (nulls last) then oldest first, and a brand-new ticket has no priority until classified, so with ~32 unprioritised test tickets on staging it
  landed at position 38 (page 2 of 25). Verified directly. The UI journey was adjusted to open the ticket by URL when it is not on page 1, and passed.
- Note B: "IN_PROGRESS to OPEN rejected" was my wrong assumption; that transition is allowed by design (only CLOSED is terminal, which passes).
- HTTPS: Let's Encrypt certificate valid to 2027-01-13; HTTP redirects 301 to HTTPS; `/healthz` 200. Renewal was **not** tested.
- Persistence: 42 tickets, 17 attachments (17 files on the volume), 41 completed AI analyses, 5 migrations, all intact across the recreates.
- BookLeaf containers healthy: api (153 MiB / 512), db (31 MiB / 512), web (2 MiB / 64).

## 8. VPS neighbours

The 13 non-BookLeaf containers running at the pre-deploy snapshot (Traefik, Daxul, KP-CRM, Printout, Vastraa) are identical in health after the deployment.

**Finding E-1 (INFORMATIONAL, external, needs owner confirmation):** the three **Aadya** containers (`aadya-api`, `aadya-db`, `aadya-web`) that were
healthy at 10:34 are gone, together with their volumes, networks and `/opt/aadya`. Root shell history shows a deliberate decommission
(`rm -rf /opt/aadya`, then checks for leftover containers/volumes/networks) from a root SSH session that logged in at 10:56 and lasted 32 minutes.
That was not this audit: my sessions last seconds, and I issued no command against Aadya. It looks intentional, but please confirm it was.

## 9. Findings

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| S-1 | was MEDIUM | Demo AI stranded after API restart/recreate | **Fixed and verified live** (sections 3, 6) |
| D-1 | LOW | Untracked `docs/architecture/02-SYSTEM-ARCHITECTURE.md` (lines ~28, 86, 96) still describes the retired design (separate `mock-ai` container, `--profile demo`, read-only FS, shared namespace). Committing it unchanged would contradict the deployed system | **Open: update before that tree is committed.** Not touched by me |
| D-2 | LOW | Image tags (`localtest`, `loginfix-20261015`) do not encode a commit; traceability relies on hash comparison (done at `3b09980`) | Open; runbook now says to tag by short SHA |
| S-2 | LOW | `npm audit --omit=dev`: 3 high, one Prisma CLI chain (`deepmerge-ts` < 8). `@prisma/client` has no dependencies, no source imports the CLI, and the newest stable `@prisma/config` still pins the vulnerable version. Not upgraded or overridden | Accepted; owner decision |
| S-3 | LOW | Author payloads include `assigneeId` (opaque id, no author page reads it) | Open; low risk |
| Q-1 | INFO | New unclassified tickets sort after all prioritised ones in the admin queue, so they can be on page 2 when many tickets are open | By design; consider surfacing newest/unprioritised first |
| S-5 | INFO | Throttling is in memory, single API instance (10 failures/account, 30/IP per 15 min) | By design |
| S-6 | INFO | The API container has internet egress (needed for real OpenRouter); "no external AI calls" is guaranteed by configuration, the mock's code and the observed connections, not by a network block | Documented |
| T-1 | INFO | Staging now holds ~42 synthetic test tickets and 17 attachments from testing | Consider reseeding before a demo |

## 10. Rollback

Server directory `/opt/bookleaf/src/infra`; backups in `backups/` (e.g. `db-20261015T113228Z.dump`).

- **AI off (recommended rollback; safest):** `docker compose -f docker-compose.yml up -d --no-build --no-deps api`. The base config has no key, so analyses
  record `AI_NOT_CONFIGURED` and tickets work manually.
- **Previous (fragile) sidecar design:** `cp docker-compose.yml.pre-incontainer docker-compose.yml; cp .env.pre-incontainer .env; rm -rf mock-ai && cp -r mock-ai.pre-incontainer mock-ai;
  rm docker-compose.demo.yml; docker compose --profile demo up -d --no-build --no-deps api mock-ai`. Note it does not survive an API restart or recreate.
- **Database damage:** stop the API, `pg_restore --clean --if-exists` from a dump (see `infra/DEPLOY.md`), start the API. Restore was proven on a disposable
  database earlier in this audit (all 10 compared tables matched row for row).

## 11. Not verified

Real OpenRouter inference; TLS certificate renewal; multi-instance behaviour; browsers other than Chromium/Edge; the exact provider request contents on the live
host (covered by test `9b`, which passed on Linux Node 22 and 24); how the admin UI reaches page 2 of the queue; the content of the other process's `docs/architecture/`
beyond the stale lines above.

## 12. Verdict

No BLOCKER or HIGH findings. The restart/recreate defect is fixed and verified on the live VPS across four lifecycle events without touching the mock; the live site
matches the committed code; data, backups and neighbours (other than the unrelated Aadya change) are intact. The remaining items are LOW/INFORMATIONAL and none blocks submission;
D-1 must be handled before the untracked architecture docs are committed, and E-1 needs your confirmation.

**READY FOR SUBMISSION**
