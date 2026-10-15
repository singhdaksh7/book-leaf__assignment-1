# BookLeaf Author Support Portal

A full-stack author support portal: authors browse their books and raise support tickets (with attachments and replies); admins triage a queue, assign tickets, add private notes, review AI-generated drafts and send replies. AI never sends anything: every draft is reviewed and sent by an admin.

## Architecture

npm-workspace monorepo: TypeScript, React/Vite, Express, PostgreSQL/Prisma, Zod. See [Architecture](docs/ARCHITECTURE.md).

| Workspace | Responsibility |
| --- | --- |
| `apps/web` (`@bookleaf/web`) | Author and admin browser UI (React, Vite). Talks to the API through a typed client; mock mode is for offline development only. |
| `apps/api` (`@bookleaf/api`) | Express REST API, cookie sessions + CSRF, attachments on local disk, Server-Sent Events, AI attempt orchestration. |
| `packages/contracts` | Zod schemas and inferred types shared by API and web (authoritative wire format). |
| `packages/db` | Prisma schema, 5 SQL migrations (constraints and triggers), importer/seed. |
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

`WEB_ORIGIN` must exactly equal the browser origin (default `http://localhost:5173`). Author logins are the synthetic `synthetic.authorN@example.test` addresses. Rebuild `@bookleaf/db` / `@bookleaf/ai` after editing them; on Windows stop the running API first (it locks the Prisma engine DLL and `prisma generate` fails with EPERM).

### Environment variables

API (`apps/api/.env.example` is the full, commented list): `DATABASE_URL`, `SESSION_SECRET` (>= 32 chars, placeholders rejected in production), `WEB_ORIGIN` (https required in production), `PORT`, `TRUST_PROXY` (hop count behind a reverse proxy), `SESSION_TTL_HOURS`, login/ticket/reply rate limits, `ATTACHMENT_DIR`, `ATTACHMENT_MAX_BYTES`, `ATTACHMENT_MAX_PER_TICKET`, and the AI settings `OPENROUTER_API_KEY` (empty = AI disabled, tickets still work), `OPENROUTER_MODEL`, `OPENROUTER_BASE_URL`, `AI_TIMEOUT_MS`, `AI_MAX_RETRIES`. Web: `VITE_API_BASE_URL`, `VITE_USE_MOCKS` (`false` for the real API; production builds always use the real API).

## Commands

| Command | Meaning |
| --- | --- |
| `npm run typecheck` | Builds shared packages, then typechecks every workspace |
| `npm run build` | Production build of all workspaces |
| `npm test` | All workspace suites (AI, API incl. embedded PostgreSQL, web). The API suite starts a throwaway PostgreSQL itself |
| `npm run test:scaffold` | Contract/Prisma/import alignment checks (run after build) |
| `npm run test:e2e` | Browser end-to-end suite (Playwright, 30 tests) against a disposable stack: embedded PostgreSQL, built API and web, mock AI provider. Needs `npm run build` first and a Chromium (`npx playwright install chromium` or `E2E_CHROMIUM_PATH`). See [Testing](docs/TESTING.md) |
| `BOOKLEAF_AI_ENTRY=<absolute path>/packages/ai/dist/index.js npm run test --workspace @bookleaf/api` | Also runs the 11 "real AI package, mocked provider" API tests (skipped otherwise). The path must be absolute: vitest runs inside `apps/api` |
| `npm run migrate:status --workspace @bookleaf/db` | Migration state of `DATABASE_URL` |

## Security notes and limitations

- Sessions: server-side, httpOnly cookie, `SameSite=Lax`, `Secure` in production, CSRF double-submit token + Origin check. The API does not serve the web app: deploy web and API **on the same site** (for example one reverse proxy: `/` -> static web, `/api` -> API) with `TRUST_PROXY` set.
- Rate limits and login throttling are in memory per API process (reset on restart; not shared across instances). SSE streams and AI single-flight also assume one API instance.
- Attachments are stored on local disk under random keys outside any served path; they must be backed up with the database. Antivirus scanning is not implemented.
- AI data minimisation: the provider receives only the ticket subject/description, the last two author-visible messages, public policy excerpts and non-financial book facts (title, status, genre, publication date, print partner, channels). Author name/email/phone/city, ISBN, MRP, royalty amounts and balances, copies sold and payout dates are never sent (allowlist in `apps/api/src/ai/context.ts`, repeated in `packages/ai`). Royalty drafts say the team will verify the figures internally; any amount a draft invents is rejected by the grounding check.
- A missing `Origin` header is accepted on mutating requests (non-browser clients); the CSRF token is still required.
- `TicketMessage` rows are append-only by convention (no edit route) but not DB-trigger protected; `AuditLog` and `InternalNote` are.
- Verified on Windows (Node 24.6, Chromium) and on Linux (Node 22 in Docker), and deployed as a staging stack behind Traefik with a Let's Encrypt certificate ([Deployment](infra/DEPLOY.md)). The live OpenRouter API was not exercised (no paid calls); staging runs without AI; see [Known limitations](docs/KNOWN_LIMITATIONS.md) and the [Security review](docs/SECURITY_REVIEW.md) (3 high `npm audit` advisories in the Prisma CLI chain, not reachable at runtime).

## Confidential source data

The original assignment PDF and JSON stay unchanged under ignored `reference/`; `data/bookleaf_sample_data.json` (confidential, ignored by git) is never committed. Use only synthetic data (`data/synthetic_seed.json`) for demos, tests and screenshots.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) · [API contract](docs/API_CONTRACT.md) · [Database schema](docs/DATABASE_SCHEMA.md) · [AI design](docs/AI_DESIGN.md)
- [Environment guide](docs/ENVIRONMENT.md) · [Testing](docs/TESTING.md) · [Demo instructions](docs/DEMO.md)
- [Security review](docs/SECURITY_REVIEW.md) · [Known limitations](docs/KNOWN_LIMITATIONS.md) · [Submission checklist](docs/SUBMISSION_CHECKLIST.md)
- [Docker deployment runbook](infra/DEPLOY.md) (production stack, backups, rollback, opt-in demo AI) · [Integration report](docs/INTEGRATION_REPORT.md)
