# Current state (2026-10-16)

Branch `integration/bookleaf-fullstack`. Remote HEAD at start: `ba35295` (verified equal to local HEAD). Commits since `ba35295` are listed by `git log ba35295..HEAD` (AI free-model guard and real-provider fixes, backup scripts, three small fixes, diagrams, SDD, deployment plan).

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
| AI package (vitest) | 485 passed (456 + 29 new: zero-spend guard, greeting normalisation, draft quality, feature check, time-frame masking) |
| API (vitest, real Postgres) | 230 passed, 0 skipped (227 + 3 new) |
| Web (vitest) | 50 passed (48 + 2 new) |
| Playwright E2E (Chrome, disposable stack, mock OpenRouter) | 30 passed (re-run after the final AI changes) |
| Scaffold / infra (`node --test`) | 9 / 12 passed |
| Typecheck (all workspaces) | clean |

The 11 API tests that showed as skipped earlier belong to `ai-real-package.test.ts`, which is skipped unless a built AI package exists at `apps/api/.tmp/ai-dist` (it never existed in this checkout). The suite now falls back to `packages/ai/dist`, so it runs after `npm run build`.

**The suites above are mock-provider results.** Separately, real OpenRouter requests were made on 2026-10-16 (free tier, account spend 0). On the default model `nvidia/nemotron-3-super-120b-a12b:free` with the final prompt: classification 6/6 correct in every run; model drafts passed the strict validator in 12 of 13 analyses (3 of 6 before prompt hardening); real failure scenarios (rejected key, nonexistent model, paid models, rate limit) handled correctly. The Gemma alternative was rate limited upstream and is unverified. This is verification with limits, not a production acceptance rate: see `AI_REAL_PROVIDER.md`.

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
