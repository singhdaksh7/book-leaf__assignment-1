# @bookleaf/api: backend guide

Express + TypeScript + Prisma on PostgreSQL. REST under `/api/v1`, Server-Sent Events for live updates, HTTP-only cookie sessions.
Shared request/response schemas come from `@bookleaf/contracts`; AI analysis comes from `@bookleaf/ai`.

## 1. Local development

**Requirements:** Node.js 22+, npm 10, PostgreSQL 16+.

1. **PostgreSQL.** The database **must use UTF8 encoding** (author names and rupee signs do not fit other encodings; on some Windows
   installs the default is `WIN1252`). The API checks `server_encoding` at startup and refuses to run otherwise.
   - Docker: `docker run --name bookleaf-pg -e POSTGRES_USER=bookleaf -e POSTGRES_PASSWORD=bookleaf -e POSTGRES_DB=bookleaf -e POSTGRES_INITDB_ARGS="--encoding=UTF8" -p 5432:5432 -d postgres:16`
   - Existing server: `CREATE DATABASE bookleaf ENCODING 'UTF8' TEMPLATE template0;`
2. **Environment.** `copy apps\api\.env.example apps\api\.env` and `copy packages\db\.env.example packages\db\.env`. Set `SESSION_SECRET` (>= 32 random
   characters) and, for seeding, the `BOOKLEAF_SEED_*` values. Real `.env` files are git-ignored.
3. **Install and build** (repo root): `npm install`, then `npm run build --workspace @bookleaf/db`.
4. **Migrate:** `npm run migrate:deploy --workspace @bookleaf/db` (use `migrate:dev` only while changing the schema).
5. **Seed:** `npm run seed --workspace @bookleaf/db` reads the confidential dataset from the ignored `data/bookleaf_sample_data.json` (or
   `BOOKLEAF_SEED_DATA_PATH`). **That file is not present in the repository**, so use `npm run seed:synthetic --workspace @bookleaf/db` for the
   fully synthetic demo dataset (`data/synthetic_seed.json`). The seed is idempotent and transactional, validates before writing, preserves
   nulls/zeros/empty arrays, never logs records, and never resets existing passwords unless `BOOKLEAF_SEED_RESET_PASSWORDS=1`.
6. **Run:** `npm run dev` (watch mode) or `npm run build` then `npm start --workspace @bookleaf/api`. `GET /healthz` is a liveness check.

### Tests

`npm test --workspace @bookleaf/api` (Vitest + Supertest, real PostgreSQL). A throwaway embedded PostgreSQL (UTF8) is started and removed
automatically, so Docker is not required. To use your own server set `TEST_DATABASE_URL` (the database name must contain `test`; tables are
truncated). Tests use synthetic data and mocked AI providers only; no network or paid call is made.

**Real AI package check.** `tests/ai-real-package.test.ts` runs the actual `@bookleaf/ai` code against a local mock of the OpenRouter endpoint.
The package is not installed in this branch yet, so the suite is skipped unless you build a committed revision first:
`node apps/api/scripts/build-ai-from-git.mjs <path-to-agent-ai-worktree> <ref>` (writes to the git-ignored `apps/api/.tmp/ai-dist`), or set
`BOOKLEAF_AI_ENTRY` to a built `dist/index.js`. The vitest summary shows it as skipped, never as passed, when the package is absent.

## 2. Authentication, sessions and CSRF

| Item | Behaviour |
| --- | --- |
| Login | `POST /auth/login` `{email, password}`; email is case-insensitive; Argon2id (19 MiB, 2 passes); unknown emails cost the same time as wrong passwords. |
| Session cookie | Opaque 256-bit token, **HttpOnly**, `SameSite=Lax`, `Secure` in production, absolute expiry (`SESSION_TTL_HOURS`). Only its SHA-256 is stored. At most 10 live sessions per user (oldest revoked). |
| CSRF cookie | `XSRF-TOKEN` (configurable), readable by script, bound to the session (HMAC). |
| Mutations | Every non-GET request except login must send `X-CSRF-Token: <XSRF-TOKEN cookie>` **and** come from `WEB_ORIGIN` (checked via `Origin`; `Sec-Fetch-Site: cross-site` is rejected). `GET /auth/me` re-issues the cookie. |
| Login CSRF | Login is origin-checked and throttled per IP and per IP+email (`429` with `Retry-After`). |
| Logout | `POST /auth/logout` deletes the session server-side (204) and closes that session's event streams. |
| Unauthenticated / wrong role | `401 UNAUTHENTICATED` / `403 FORBIDDEN`; a record the caller may not see is always `404 NOT_FOUND`, never `403`. |

Deployment note: cookies are `SameSite=Lax`, so the web app and API must be **same-site** (same registrable domain) or the API must be served under
the web origin through a reverse proxy. A cross-site deployment (for example `*.vercel.app` calling a VPS domain) will not receive the session cookie.

## 3. Endpoints (`/api/v1`)

| Method and path | Role | Notes |
| --- | --- | --- |
| `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | public / any / any | See section 2. |
| `GET /author/books` | author | Own books only, paginated (`page`, `pageSize`; unknown query keys are `400`). |
| `GET /author/books/:bookId` | author | One owned book as the canonical book DTO. Ownership is in the SQL `WHERE`; another author's id and a missing id both give the same `404`. No query parameters. |
| `POST /author/tickets` | author | `{bookId \| null, subject, description}`. A linked book must belong to the caller (`404` otherwise, indistinguishable from a missing book). Ownership is verified inside the insert transaction and again by a database trigger. 30 per hour per user by default. |
| `GET /author/tickets` | author | Own tickets, newest first; filters `status, category, priority, from, to`, plus pagination. A date-only `to` includes that whole day. |
| `GET /author/tickets/:id` | author | Ticket plus `AUTHOR`-visible messages only. Internal notes, admin-only messages and AI data are never loaded. |
| `POST /author/tickets/:id/messages` | author | `{body}` (same schema as admin replies, 1-10,000 chars). Always an `AUTHOR`-visible message written by the caller; extra fields (visibility, notes, AI) are ignored. Ownership in the lock query (foreign = `404`), closed tickets `409`, bumps `updatedAt`, audits `ticket.author_reply.created`, emits `ticket.reply.created`. Retried identical text within 60 s returns the original; 60 per hour per author by default (`AUTHOR_REPLY_LIMIT_PER_HOUR`). Does not change ticket status. |
| `POST /author/tickets/:id/attachments`, `GET .../attachments`, `GET .../attachments/:attachmentId` | author | See section 4. |
| `GET /admin/tickets` | admin | Queue. Order: unresolved first, then priority (`CRITICAL`..`LOW`, unclassified last), then oldest first; resolved/closed follow by last update; id breaks ties. Same filters and pagination. |
| `GET /admin/tickets/:id` | admin | Ticket, author, book, all messages, internal notes, assignments, latest AI attempt, audit events (no before/after values). |
| `PATCH /admin/tickets/:id` | admin | `status`, `category`, `priority`. Status follows a transition table (`OPEN`, `IN_PROGRESS`, `RESOLVED` move freely and may be closed; `CLOSED` is final). A closed ticket cannot be modified. One audit row per changed field. |
| `POST /admin/tickets/:id/replies` | admin | The **only** way a message becomes visible to an author. An identical reply from the same admin within 60 s returns the original (retry safe). |
| `POST /admin/tickets/:id/internal-notes` | admin | Admin-only, immutable. Same retry protection. |
| `PUT /admin/tickets/:id/assignment` | admin | `{assigneeId}`: your own id (assign to self) or `null` (release). Assigning to someone else is `403`. Repeating the same request changes nothing. |
| `GET` / `POST /admin/tickets/:id/ai-analysis` | admin | Latest attempt / start or join an analysis (`202` pending, `200` terminal). |
| `GET /events/tickets` | any | Server-Sent Events (section 7). |

Errors always use `{ error: { code, message, details?, requestId? } }` with `VALIDATION_ERROR` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403,
`NOT_FOUND` 404, `CONFLICT` 409, `RATE_LIMITED` 429, `INTERNAL_ERROR` 500. Messages never contain database, provider or stack details.

## 4. Attachments

Not part of the frozen contract (see section 8). Upload is a **raw body**, not multipart:

```
POST /api/v1/author/tickets/:ticketId/attachments?filename=report.pdf
Content-Type: application/pdf          (or image/png, image/jpeg, image/webp, text/plain)
X-CSRF-Token: <token>
<file bytes>
```

Response `201 { attachment: { id, ticketId, fileName, contentType, sizeBytes, createdAt } }`. Validation: type allow-list; content signature must match the declared
type; max `ATTACHMENT_MAX_BYTES` (5 MiB) and `ATTACHMENT_MAX_PER_TICKET` (5, enforced under a row lock); closed tickets refuse uploads. Files are stored under random
48-hex keys in `ATTACHMENT_DIR` (the filename is display metadata only, sanitised, never used in a path). Download returns the bytes with
`Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` and a sandboxing CSP. Authors reach only their own tickets' files; admins use
`/admin/tickets/:id/attachments[/:attachmentId]`. There is no virus scanning; files are never executed or rendered inline.

## 5. Admin workflows and audit

All admin mutations run in one transaction with their audit row(s), so a failed audit write rolls the change back. Audit actions:
`ticket.status|category|priority.updated`, `ticket.reply.created`, `ticket.internal_note.created`, `ticket.assignment.updated`,
`ticket.ai_analysis.requested`. Audit rows store enum values and ids, never message text; the table is append-only (database trigger).
Database triggers also enforce: assignees and note authors must be admins, internal notes are immutable, assignment history is append-only, and a
ticket can only link a book owned by its author.

## 6. AI analysis lifecycle

The backend never classifies or drafts; `@bookleaf/ai` does. The backend owns persistence, scheduling and recovery.

1. **Ticket creation** writes the ticket **and** a `PENDING` `AiAnalysis` row in one transaction, then returns. AI runs afterwards in the background; an AI
   outage can never fail or delay ticket creation.
2. **Run:** the engine receives the ticket text, the linked book's fields, the author's name and the last two author-visible messages (never internal notes or admin-only
   messages). The result is stored atomically as `COMPLETED` or `FAILED` only if the attempt is still `PENDING`, so a late result cannot overwrite anything.
3. **States:** model result -> `COMPLETED`; usable partial fallback (model category with template draft, or the reverse) -> `COMPLETED` (logged as `PARTIAL_FALLBACK`; the
   HTTP shape cannot express it); no usable model output -> `FAILED` with a sanitised code and no draft. Usage tokens are summed; **cost stays `null` when the provider reports none**.
4. **Single flight:** a partial unique index allows one `PENDING` attempt per ticket across all processes; concurrent refreshes join the same attempt (a 30 s cooldown also
   returns the latest attempt instead of paying twice).
5. **Recovery** (every minute, any process): `PENDING` attempts older than the package's worst-case run time plus margin are closed as `AI_ATTEMPT_ABANDONED`; transient
   failures (`AI_TIMEOUT`, `AI_RATE_LIMITED`, `AI_PROVIDER_ERROR`, `AI_NETWORK_ERROR`, abandoned) are retried at most twice, at least a minute apart, never on closed tickets. Other
   codes (`AI_INVALID_OUTPUT`, `AI_NOT_CONFIGURED`, ...) are not retried automatically; an admin can refresh.
6. **Review:** a draft is shown to admins only and is **never sent automatically**. The only send path is `POST /admin/tickets/:id/replies` with text an admin submits.

The engine binds to `@bookleaf/ai` at startup (`createAiServiceFromEnv`, `analyzeForPersistence`, `pendingRow`, `abandonedRow`, `worstCaseAnalysisMs`). If the installed package does
not expose them, every analysis is recorded as `FAILED` / `AI_NOT_CONFIGURED` and the API logs a warning.

## 7. Live updates: SSE and polling

`GET /events/tickets` (session cookie, `credentials: "include"`). Events: `ticket.created`, `ticket.updated`, `ticket.reply.created`, `ticket.analysis.updated`; each
carries exactly `{ ticketId, occurredAt, version }` (`version` = the ticket's `updatedAt`). Authors receive only their own tickets' events; analysis and internal-note events go to admins only.

- **Reconnect:** browsers resend `Last-Event-ID` (`<epoch-ms>-<n>`). The server replays one `ticket.updated` per ticket changed since then (up to 200; if truncated it sends the
  comment `: catch-up truncated; refetch ticket lists`). Delivery is at-least-once: dedupe on `ticketId` + `version`. Do not close the `EventSource` on error; the browser reconnects itself.
- **Polling fallback:** poll `GET /author/tickets[/:id]` or `GET /admin/tickets` every 20-30 s; `updatedAt` equals the event `version`.
- **Lifetime:** streams close on logout, session expiry or revocation (checked every 25 s), at most 5 per user, slow readers are dropped, keep-alive comments every 25 s.
- Live push is per API process. A second API instance would not see the first one's events (reconnect catch-up and polling still work).

## 8. Known integration limitations

- **Author replies and book detail** are implemented (`POST /author/tickets/:id/messages`, `GET /author/books/:bookId`) but are not yet in `API_CONTRACT.md`; the web UI's reply box still does not call the messages endpoint.
- **Attachments:** request/response format above is a backend proposal; the web UI does not upload or download yet.
- **Partial AI fallback** is visible only in logs and `confidence`; the attempt schema has no field for it.
- **Queue age indicator:** not in the ticket summary schema; clients compute age from `createdAt`.
- **Status transition table** is a backend assumption (the docs name the statuses but not the rules): `src/tickets/transitions.ts`.
- Throttles and SSE fan-out are in-memory (single API instance). There is no virus scanning of attachments. Graceful shutdown was not exercised on Windows.
