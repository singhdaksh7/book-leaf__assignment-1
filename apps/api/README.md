# @bookleaf/api - backend notes

Express + TypeScript + Prisma/PostgreSQL. Milestone 1 implements: database migrations, seed importer, authentication
(login/logout/me), and the author books API. Ticket, admin, attachment, SSE and AI routes are **not** implemented yet.

## Local development

1. Start PostgreSQL 16+ (any of):
   - Docker: `docker run --name bookleaf-pg -e POSTGRES_USER=bookleaf -e POSTGRES_PASSWORD=bookleaf -e POSTGRES_DB=bookleaf -p 5432:5432 -d postgres:16`
   - a local install, creating the role/database above.
2. `copy apps\api\.env.example apps\api\.env` and `copy packages\db\.env.example packages\db\.env`; set `SESSION_SECRET` (>= 32 chars) and the seed passwords.
3. From the repo root: `npm install`, `npm run build --workspace @bookleaf/db`, then
   `npm run migrate:deploy --workspace @bookleaf/db` (or `migrate:dev` while changing the schema).
4. Seed: `npm run seed --workspace @bookleaf/db` (needs the ignored `data/bookleaf_sample_data.json` or `BOOKLEAF_SEED_DATA_PATH`),
   or `npm run seed:synthetic --workspace @bookleaf/db` for the fully synthetic demo dataset in `data/synthetic_seed.json`.
5. `npm run dev` starts the API on `PORT` (default 3000). `GET /healthz` is a liveness check.

The seed is idempotent and transactional, validates everything before writing, preserves nulls/zeros/empty arrays, never logs records,
and leaves existing passwords alone unless `BOOKLEAF_SEED_RESET_PASSWORDS=1`.

## Tests

`npm test --workspace @bookleaf/api` (Vitest + Supertest). Tests need a real PostgreSQL: by default a throwaway embedded PostgreSQL is
started and removed automatically (no Docker needed). To use your own server set `TEST_DATABASE_URL` (database name must contain `test`;
tables are truncated). Tests use synthetic data only.

## Authentication and CSRF (frontend contract)

- `POST /api/v1/auth/login` sets an HttpOnly, SameSite=Lax session cookie (`Secure` in production) and a readable CSRF cookie
  (`bookleaf_csrf`). Send requests with `credentials: "include"`.
- Every non-GET request other than login must send `X-CSRF-Token: <value of the bookleaf_csrf cookie>` and come from `WEB_ORIGIN`.
  If the cookie is missing, call `GET /api/v1/auth/me`, which re-issues it.
- Login is origin-checked (login CSRF) and throttled per IP and per IP+email (429 with `Retry-After`). The throttle is in-memory, per process.
- Logout deletes the server-side session row; the old cookie stops working immediately. Sessions expire after `SESSION_TTL_HOURS`.

## Database notes

Migrations: `20261014000000_init` (generated from `schema.prisma`, including indexes) and `20261014000100_integrity_checks`
(email normalisation, non-negative book values, AI-analysis state invariants, append-only audit log trigger).

## Milestone 3: conversations, workflow, AI persistence, SSE

- **Admin actions** (all CSRF-protected, audited in the same transaction): `POST /admin/tickets/:id/replies` (the only way a message reaches an author; retried identical bodies within 60 s return the original), `POST .../internal-notes` (admin-only), `PUT .../assignment` (self or unassign), `GET|POST .../ai-analysis`.
- **AI**: `AiAttemptService` writes a PENDING `AiAnalysis` row in the same transaction as the ticket, runs the engine in the background, and stores COMPLETED/FAILED atomically. It never creates a message or changes ticket status. A partial unique index allows one PENDING attempt per ticket across all processes; stale PENDING rows are closed as `AI_ATTEMPT_ABANDONED`; transient failures are retried at most twice, at least a minute apart (`recover()` runs every minute). At startup `loadPackageEngine` binds to `@bookleaf/ai` (`createAiServiceFromEnv`, `analyzeForPersistence`, `pendingRow`, `abandonedRow`, `worstCaseAnalysisMs`); if the installed package lacks them, analyses are recorded as FAILED `AI_NOT_CONFIGURED` and tickets are unaffected.
- **SSE**: `GET /events/tickets` (session cookie). Events `ticket.created|updated|reply.created|analysis.updated` carry only `ticketId`, `occurredAt`, `version`. Authors receive only their own tickets' events; analysis and internal-note events are admin-only. Reconnect with `Last-Event-ID` (`<epoch-ms>-<n>`) replays a `ticket.updated` per changed ticket (at-least-once: dedupe on `ticketId`+`version`). Live push is per API process; if the stream is unavailable poll `GET /author/tickets[/:id]` or `GET /admin/tickets` every 20-30 s (`updatedAt` equals the event `version`). Streams close on logout, session expiry or revocation.
