# BookLeaf Author Support Portal

A full-stack author support portal: authors register themselves, browse their books and raise support tickets (with attachments and replies); admins triage a queue, assign tickets, add private notes, review AI-generated drafts and send replies. AI never sends anything: every draft is reviewed and sent by an admin.

## Live demo

**https://bookleaf.77.37.45.177.sslip.io** (API `bookleaf-api:3eb1aff`). Reviewer logins (one admin, ten sample authors `AUTH001`-`AUTH010` with the assignment's 18 books) are sent separately and are not in this repository. Walkthrough: [docs/submission/DEMO_WALKTHROUGH.md](docs/submission/DEMO_WALKTHROUGH.md). Approach and trade-offs on one page: [docs/submission/APPROACH_ONE_PAGER.md](docs/submission/APPROACH_ONE_PAGER.md).

**AI status, stated plainly:** classification, priority and policy-grounded drafts use real OpenRouter calls (model `nvidia/nemotron-3-super-120b-a12b:free`, cost $0). Locally this was verified on the final code: 6/6 categories and priorities correct, 5/6 model drafts accepted (the sixth falls back to a labelled policy template). On the live site the free daily quota was exhausted, so live analyses currently end `AI_RATE_LIMITED` and admins reply manually; no successful live inference is claimed. A reviewer does **not** need a key for the hosted demo; to run your own copy, put `OPENROUTER_API_KEY` (and optionally `OPENROUTER_MODEL`, `:free` ids only) in the server-side environment, see [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md).

## Architecture

npm-workspace monorepo: TypeScript, React/Vite, Express, PostgreSQL/Prisma, Zod. See [Architecture](docs/ARCHITECTURE.md).

| Workspace | Responsibility |
| --- | --- |
| `apps/web` (`@bookleaf/web`) | Author and admin browser UI (React, Vite). Talks to the API through a typed client; mock mode is for offline development only. |
| `apps/api` (`@bookleaf/api`) | Express REST API, cookie sessions + CSRF, attachments on local disk, Server-Sent Events, AI attempt orchestration. |
| `packages/contracts` | Zod schemas and inferred types shared by API and web (authoritative wire format). |
| `packages/db` | Prisma schema, 5 SQL migrations (constraints and triggers), importer/seed, the admin tool (`admin:ensure`) and the synthetic-data cleanup tool (`cleanup:synthetic`, dry-run by default). |
| `packages/ai` | Provider-neutral AI service (OpenRouter adapter): grounded classification and drafting, prompt-injection hardening, bounded retries. |

## Local setup

Requirements: Node.js `^22.22.2 || ^24.15.0 || >=26` (dependencies declare this; older Node only warns), npm 10, PostgreSQL 16+ with a **UTF8** database.

```powershell
npm install
copy apps\api\.env.example apps\api\.env      # then edit DATABASE_URL, SESSION_SECRET, WEB_ORIGIN
copy packages\db\.env.example packages\db\.env
npm run build
npm run migrate:deploy --workspace @bookleaf/db
# Synthetic demo data only (10 fake authors, 18 books). Passwords come from the environment, never from the dataset:
$env:BOOKLEAF_SEED_AUTHOR_PASSWORD="choose-a-demo-password"
$env:BOOKLEAF_SEED_ADMIN_EMAIL="admin@example.test"; $env:BOOKLEAF_SEED_ADMIN_PASSWORD="choose-another-password"
npm run seed:synthetic --workspace @bookleaf/db
npm run dev                                    # API on :3000
$env:VITE_USE_MOCKS="false"; $env:VITE_API_BASE_URL="http://localhost:3000/api/v1"; npm run dev:web   # web on :5173
```

`WEB_ORIGIN` must exactly equal the browser origin (default `http://localhost:5173`). Locally, either register a new author at `/register` or sign in with the synthetic `synthetic.authorN@example.test` addresses. Rebuild `@bookleaf/db` / `@bookleaf/ai` after editing them; on Windows stop the running API first (it locks the Prisma engine DLL and `prisma generate` fails with EPERM).

### Accounts: authors self-register, one fixed admin

* **Authors** create their own account at `/register` (name, e-mail, password with confirmation). They start with an empty workspace: no books, no tickets, no access to anyone else's data.
* **The administrator** is never self-registered. The public endpoint accepts exactly four fields and rejects `role` or any other field; there is no API that creates or promotes an admin. The single admin is created and rotated on the server: `BOOKLEAF_ADMIN_EMAIL=... BOOKLEAF_ADMIN_PASSWORD=... npm run admin:ensure --workspace @bookleaf/db` (add `-- --rotate-password` for an existing admin). There is no default admin password anywhere. See [Admin account](docs/release/ADMIN_ACCOUNT.md).
* **Production never receives the synthetic seed:** with `NODE_ENV=production` the synthetic seed is refused unless `BOOKLEAF_ALLOW_SYNTHETIC_SEED=yes-i-understand` is set. Removing the synthetic records already in a database is the job of `npm run cleanup:synthetic --workspace @bookleaf/db` (dry-run by default, never touches the admin or the audit log); see [Cleanup inventory](docs/release/FINAL_CLEANUP_INVENTORY.md) and the [release plan](docs/release/REGISTRATION_RELEASE_PLAN.md).

### Environment variables

API (`apps/api/.env.example` is the full, commented list): `DATABASE_URL`, `SESSION_SECRET` (>= 32 chars, placeholders rejected in production), `WEB_ORIGIN` (https required in production), `PORT`, `TRUST_PROXY` (hop count behind a reverse proxy), `SESSION_TTL_HOURS`, login/registration/ticket/reply rate limits (`REGISTER_LIMIT_PER_IP_PER_HOUR` 5, `REGISTER_LIMIT_GLOBAL_PER_HOUR` 200), `ATTACHMENT_DIR`, `ATTACHMENT_MAX_BYTES`, `ATTACHMENT_MAX_PER_TICKET`, and the AI settings `OPENROUTER_API_KEY` (empty = AI disabled, tickets still work), `OPENROUTER_MODEL`, `OPENROUTER_BASE_URL`, `AI_TIMEOUT_MS`, `AI_MAX_RETRIES`. Web: `VITE_API_BASE_URL`, `VITE_USE_MOCKS` (`false` for the real API; production builds always use the real API).

## Commands

| Command | Meaning |
| --- | --- |
| `npm run typecheck` | Builds shared packages, then typechecks every workspace |
| `npm run build` | Production build of all workspaces |
| `npm test` | All workspace suites (AI, API incl. embedded PostgreSQL, web). The API suite starts a throwaway PostgreSQL itself |
| `npm run test:scaffold` | Contract/Prisma/import alignment checks (run after build) |
| `npm run test:e2e` | Browser end-to-end suite (Playwright, 41 tests) against a disposable stack: embedded PostgreSQL, built API and web, mock AI provider. Needs `npm run build` first and a Chromium (`npx playwright install chromium` or `E2E_CHROMIUM_PATH`). See [Testing](docs/TESTING.md) |
| `BOOKLEAF_AI_ENTRY=<absolute path>/packages/ai/dist/index.js npm run test --workspace @bookleaf/api` | Also runs the 11 "real AI package, mocked provider" API tests (skipped otherwise). The path must be absolute: vitest runs inside `apps/api` |
| `npm run migrate:status --workspace @bookleaf/db` | Migration state of `DATABASE_URL` |
| `npm run cleanup:synthetic --workspace @bookleaf/db` | **Dry run**: counts, ids and a confirmation token for removing the synthetic records. Add `-- --execute --confirm <token> --backup-stamp <stamp>` to delete (see the release plan) |
| `npm run admin:ensure --workspace @bookleaf/db` | Create or rotate the single admin from `BOOKLEAF_ADMIN_EMAIL` / `BOOKLEAF_ADMIN_PASSWORD` |

## Security notes and limitations

- Registration: public, author-only, strict body (no role field), Argon2id, password policy, unique-index duplicate guard, per-IP and global rate limits, generic `409` for an existing address (which still reveals that the address is registered: there is no e-mail verification).
- Sessions: server-side, httpOnly cookie, `SameSite=Lax`, `Secure` in production, CSRF double-submit token + Origin check. The API does not serve the web app: deploy web and API **on the same site** (for example one reverse proxy: `/` -> static web, `/api` -> API) with `TRUST_PROXY` set.
- Rate limits and login throttling are in memory per API process (reset on restart; not shared across instances). SSE streams and AI single-flight also assume one API instance.
- Attachments are stored on local disk under random keys outside any served path; they must be backed up with the database. Antivirus scanning is not implemented.
- AI data minimisation: the provider receives only the ticket subject/description, the last two author-visible messages, public policy excerpts and non-financial book facts (title, status, genre, publication date, print partner, channels). Author name/email/phone/city, ISBN, MRP, royalty amounts and balances, copies sold and payout dates are never sent (allowlist in `apps/api/src/ai/context.ts`, repeated in `packages/ai`). Royalty drafts say the team will verify the figures internally; any amount a draft invents is rejected by the grounding check.
- A missing `Origin` header is accepted on mutating requests (non-browser clients); the CSRF token is still required.
- `TicketMessage` rows are append-only by convention (no edit route) but not DB-trigger protected; `AuditLog` is append-only at the database level (update, delete and mass delete are rejected). `InternalNote` and `TicketAssignment` reject `UPDATE` by trigger (assignments allow only the `SET NULL` of a removed assignee), but their triggers do not cover `DELETE`, so a direct SQL delete is not blocked; the API has no delete route for either.
- Verified on Windows (Node 24.6, Chromium) and on Linux (Node 22 in Docker), and deployed as a staging stack behind Traefik with a Let's Encrypt certificate ([Deployment](infra/DEPLOY.md)). Real OpenRouter calls were exercised locally on the free model (see [AI results](docs/release/AI_REAL_PROVIDER.md)); the live site's key is currently quota-limited; see [Known limitations](docs/KNOWN_LIMITATIONS.md) and the [Security review](docs/SECURITY_REVIEW.md) (3 high `npm audit` advisories in the Prisma CLI chain, not reachable at runtime).

## Source data

The assignment's original JSON/PDF are not in this repository (`data/bookleaf_sample_data.json` and `reference/` are git-ignored). The live demo database contains the assignment's 10 authors and 18 books, imported from that file with unique per-author passwords that are delivered outside Git. Tests and local setup use only the synthetic fixture (`data/synthetic_seed.json`).

## Documentation

- [Architecture](docs/ARCHITECTURE.md) · [API contract](docs/API_CONTRACT.md) · [Database schema](docs/DATABASE_SCHEMA.md) · [AI design](docs/AI_DESIGN.md)
- [Environment guide](docs/ENVIRONMENT.md) · [Testing](docs/TESTING.md) · [Demo instructions](docs/DEMO.md)
- [Security review](docs/SECURITY_REVIEW.md) · [Known limitations](docs/KNOWN_LIMITATIONS.md) · [Submission checklist](docs/SUBMISSION_CHECKLIST.md)
- [QA reports](docs/qa/FINAL_RELEASE_CHECKLIST.md) (feature matrix, E2E, security, AI, VPS, bug register) · [Architecture](docs/architecture/README.md) · [Live test scripts](tests/live/README.md)
- [Registration release plan](docs/release/REGISTRATION_RELEASE_PLAN.md) · [Cleanup inventory](docs/release/FINAL_CLEANUP_INVENTORY.md) · [Admin account](docs/release/ADMIN_ACCOUNT.md)
- [Docker deployment runbook](infra/DEPLOY.md) (production stack, backups, rollback, opt-in demo AI) · [Integration report](docs/INTEGRATION_REPORT.md)
