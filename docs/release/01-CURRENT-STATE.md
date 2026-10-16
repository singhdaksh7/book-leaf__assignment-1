# Current state (2026-10-16)

Branch `integration/bookleaf-fullstack`. Remote HEAD at start: `ba35295` (verified equal to local HEAD). Local commits since (not pushed): `452d323`, `a53c8bc`, `fecfdb8`, `f58c6c4`, `a565864`, `9a2a3a3` and the documentation commit that follows them.

## Verified inventory (counted from source this session)

| Item | Count | How |
| --- | --- | --- |
| Database tables | 11 | `model` blocks in `packages/db/prisma/schema.prisma` match the ERD |
| API operations | 24 | method entries in `docs/architecture/openapi.yaml` |
| Frontend routes | 10 + catch-all 404 | `apps/web/src/router/AppRoutes.tsx` |
| Mermaid diagram sources | 46 (35 existing + 11 new); all 46 render without syntax errors | `mmdc` run, this session |
| Pre-rendered SVG/PNG in the repository | 20 (8 existing + 12 new/updated) | The earlier "35 rendered diagrams" figure was 35 *sources*; only 8 had been rendered |

## Test results (this session, this commit)

| Suite | Result |
| --- | --- |
| AI package (vitest) | 461 passed (456 + 5 new zero-spend guard tests) |
| API (vitest, real Postgres) | 230 passed, 0 skipped (227 + 3 new) |
| Web (vitest) | 50 passed (48 + 2 new) |
| Playwright E2E (Chrome, disposable stack, mock OpenRouter) | 30 passed |
| Scaffold / infra (`node --test`) | 9 / 12 passed |
| Typecheck (all workspaces) | clean |

The 11 API tests that showed as skipped earlier belong to `ai-real-package.test.ts`, which is skipped unless a built AI package exists at `apps/api/.tmp/ai-dist` (it never existed in this checkout). The suite now falls back to `packages/ai/dist`, so it runs after `npm run build`.

**These are mock-provider results.** No request to OpenRouter has been made: no API key is available. See `AI_REAL_PROVIDER.md` for the free-model evidence and the blocked acceptance run.

## Live VPS (read-only inspection)

| Finding | Detail |
| --- | --- |
| BookLeaf containers | `bookleaf-web:ee9b387`, `bookleaf-api:localtest`, `bookleaf-db` (postgres:16-alpine), all healthy; `/healthz` 200 |
| AI mode | **Demonstration mock** (`MOCK_AI_ACK` set, model `demo/mock-not-a-real-model`, base URL `127.0.0.1:8080`, placeholder key). Not real inference |
| Source tree | `/opt/bookleaf/src` is not a git repository; the deployed revision cannot be compared with GitHub |
| TLS | Let's Encrypt, expires 2027-01-13 |
| Resources | disk 30% used (34 GB free), memory 1.5 of 3.9 GB used, load 0.3 |
| Exposure | Only 22, 80, 443 listen publicly; the database sits on an internal Docker network |
| Backups | four manual **unencrypted** local pairs (latest 2026-10-16 03:05 UTC); no cron, no timer, no off-host copy |
| Rollback images | `bookleaf-api:pre-mockai`, `bookleaf-web:loginfix-20261015`, `bookleaf-web:localtest` exist but a host cron (`docker image prune -af --filter until=24h`) will delete unused images older than 24 h |
| Host | reboot pending (`/var/run/reboot-required`); not changed |
| Aadya | not listed among running containers or in `/opt` (`ls /opt`: bookleaf, containerd, daxul_labs, kp-crm, vastraa). Reported as a separate incident; no restoration attempted |
| Neighbours | printout, vastraa, kp-crm, daxul_labs and traefik all healthy; untouched |

## Defect triage

| Reported issue | Class | Outcome |
| --- | --- | --- |
| Login rejects emails with surrounding whitespace | SAFE SMALL FIX | Fixed (contract trims); regression tests added; verified failing (400) without the fix |
| Authenticated user visiting /login is not redirected | SAFE SMALL FIX | Fixed; tests for author and admin |
| Developer-style "API Mode" text in the sidebar | SAFE SMALL FIX | Hidden in production builds (still shown in dev) |
| AI rule-based fallback shown as normal analysis (new finding) | SAFE SMALL FIX | Rationale now carries a visible notice for non-MODEL results; no migration; tests added |
| Concurrent identical requests can create duplicate tickets | DEFERRED | Needs an idempotency design (legitimate repeat submissions exist) |
| Admin search covers only the current page | DEFERRED | Needs a server-side search parameter and contract change |
| Health endpoint is liveness-only | OPTIONAL | Add a readiness check later; not needed for the assignment |
| InternalNote/TicketAssignment deletion not trigger-protected | DEFERRED | Requires a database migration, which was not approved |
