# 10. API Reference

Every route below was read from `apps/api/src/app.ts` and the route modules it mounts. **There are exactly 24 route handlers: 23 under `/api/v1` plus `GET /healthz`.** No other route exists (`/api/v1/*` falls through to a 404 `Route not found`). A machine-readable OpenAPI 3.1 description is in [`openapi.yaml`](openapi.yaml); see §10.12 for what in it is verified.

## 10.1 Conventions

| Topic | Rule |
| --- | --- |
| Base path | `/api/v1` (same origin as the SPA; Traefik routes `/api/` and `/healthz` to the API) |
| Format | JSON, `Content-Type: application/json` (attachments use raw bytes). JSON request bodies are limited to 100 kB |
| Authentication | Session cookie `bookleaf_session` (HttpOnly). Roles: `AUTHOR` (must also have an author profile) or `ADMIN` |
| CSRF | Every non-`GET` request that carries a session also needs header `X-CSRF-Token` (value of cookie `XSRF-TOKEN`) and a trusted `Origin` |
| Caching | `Cache-Control: no-store` on every `/api/v1` response |
| Correlation | Response header `X-Request-Id` (client may supply one matching `^[A-Za-z0-9_-]{8,64}$`) |
| Error body | `{ "error": { "code", "message", "details"?, "requestId"? } }`; codes `VALIDATION_ERROR` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409, `RATE_LIMITED` 429 (+ `Retry-After`), `INTERNAL_ERROR` 500 |
| Pagination | `page` ≥ 1 (default 1), `pageSize` 1–100 (default 25); list responses `{ items, page, pageSize, total }` |
| Ticket filters | `status`, `category`, `priority` (enums), `from`, `to` (dates; a date-only `to` includes that whole day; `from ≤ to`). Unknown query keys are rejected (400) |
| Foreign resources | A resource that exists but belongs to another author returns the **same 404** as a missing one |
| Roles on 401/403 | No/expired session → 401. Wrong role → 403 |

Shared object shapes are defined once in `packages/contracts/src/index.ts` (Zod). Names used below: **CurrentUser** `{id, email, role, authorProfile|null}`; **Book** (all book fields incl. financial integers); **TicketSummary** `{id, authorId, bookId|null, subject, status, category|null, priority|null, assigneeId|null, createdAt, updatedAt}`; **Ticket** = TicketSummary + `description`; **AuthorMessage** `{id, ticketId, authorId, body, visibility:"AUTHOR", createdAt}`; **Attachment** `{id, ticketId, fileName, contentType, sizeBytes, createdAt}`; **AiAttempt** `{id, ticketId, createdAt, status, analysis, errorCode}` (a `PENDING` attempt has `analysis: null`; `COMPLETED` has `analysis: {category, priority, confidence, rationale, draftResponse, requiresHumanReview: true, knowledgeBaseCitations[]}`; `FAILED` has `errorCode`).

## 10.2 Endpoint inventory

| # | Method | Path | Role | Domain |
| - | --- | --- | --- | --- |
| 1 | GET | `/healthz` | none | Health |
| 2 | POST | `/api/v1/auth/login` | none | Authentication |
| 3 | POST | `/api/v1/auth/logout` | any signed in | Authentication |
| 4 | GET | `/api/v1/auth/me` | any signed in | Authentication |
| 5 | GET | `/api/v1/author/books` | AUTHOR | Books |
| 6 | GET | `/api/v1/author/books/:bookId` | AUTHOR | Books |
| 7 | POST | `/api/v1/author/tickets` | AUTHOR | Tickets |
| 8 | GET | `/api/v1/author/tickets` | AUTHOR | Tickets |
| 9 | GET | `/api/v1/author/tickets/:ticketId` | AUTHOR | Tickets |
| 10 | POST | `/api/v1/author/tickets/:ticketId/messages` | AUTHOR | Messages |
| 11 | POST | `/api/v1/author/tickets/:ticketId/attachments` | AUTHOR | Attachments |
| 12 | GET | `/api/v1/author/tickets/:ticketId/attachments` | AUTHOR | Attachments |
| 13 | GET | `/api/v1/author/tickets/:ticketId/attachments/:attachmentId` | AUTHOR | Attachments |
| 14 | GET | `/api/v1/admin/tickets` | ADMIN | Admin / Tickets |
| 15 | GET | `/api/v1/admin/tickets/:ticketId` | ADMIN | Admin / Tickets |
| 16 | PATCH | `/api/v1/admin/tickets/:ticketId` | ADMIN | Admin / Tickets |
| 17 | POST | `/api/v1/admin/tickets/:ticketId/replies` | ADMIN | Messages |
| 18 | POST | `/api/v1/admin/tickets/:ticketId/internal-notes` | ADMIN | Admin |
| 19 | PUT | `/api/v1/admin/tickets/:ticketId/assignment` | ADMIN | Admin |
| 20 | GET | `/api/v1/admin/tickets/:ticketId/ai-analysis` | ADMIN | AI |
| 21 | POST | `/api/v1/admin/tickets/:ticketId/ai-analysis` | ADMIN | AI |
| 22 | GET | `/api/v1/admin/tickets/:ticketId/attachments` | ADMIN | Attachments |
| 23 | GET | `/api/v1/admin/tickets/:ticketId/attachments/:attachmentId` | ADMIN | Attachments |
| 24 | GET | `/api/v1/events/tickets` | any signed in | Events (SSE) |

By domain: Health 1, Authentication 3, Books 2, Author tickets 3 (#7–9), Admin tickets 3 (#14–16), Messages 2 (#10, #17), Admin operations 2 (#18–19), AI 2 (#20–21), Attachments 5 (#11–13, #22–23), Events 1 = 24.

## 10.3 Health

### `GET /healthz`

Liveness only. Role: none. Response `200 {"status":"ok"}`. Mounted before authentication and outside `/api/v1`; used by the container health checks and routed by Traefik. It does **not** check the database. Security: reveals nothing beyond liveness.

## 10.4 Authentication

### `POST /api/v1/auth/login`

* Purpose: create a session. Role: none (anonymous).
* Body: `{ email: string(email), password: string(min 1) }`. E-mail is trimmed and lower-cased server-side.
* `200 { user: CurrentUser }` and two `Set-Cookie` headers (`bookleaf_session`, `XSRF-TOKEN`).
* Errors: `400` invalid body; `401` `Invalid email or password` (identical for unknown e-mail and wrong password); `403` `Request origin is not allowed` (Origin ≠ `WEB_ORIGIN`, or `Sec-Fetch-Site: cross-site`), or invalid CSRF token if a stale session cookie is also sent; `429` after 10 failures per (IP, account) or 30 per IP in 15 minutes, with `Retry-After`.
* Security: Argon2id verification with timing equalisation; origin check substitutes for CSRF here; session token stored only as a SHA-256 hash.

### `POST /api/v1/auth/logout`

Role: any signed in. No body. `204`, deletes the session row, closes that session's event streams, clears both cookies. `401` without a session; `403` on bad CSRF/Origin.

### `GET /api/v1/auth/me`

Role: any signed in. `200 { user: CurrentUser }`; re-issues the `XSRF-TOKEN` cookie with the session's expiry. `401` without a session. Does not extend the session.

## 10.5 Books (author)

### `GET /api/v1/author/books`

Role: AUTHOR. Query: `page`, `pageSize` only (`.strict()`; anything else → 400). `200 { items: Book[], page, pageSize, total }` ordered by `externalBookId`. Scope: the caller's own books only (profile id from the session). `403` for an admin or an author without a profile.

### `GET /api/v1/author/books/:bookId`

Role: AUTHOR. No query parameters allowed. `200 Book` (the bare object, **not** wrapped). `404 Book not found` for a missing or foreign book. Note: Book includes financial fields (MRP, royalty amounts, copies sold); these are shown to the owning author only.

## 10.6 Tickets

### `POST /api/v1/author/tickets`

* Role: AUTHOR. Body: `{ bookId: string|null, subject: string(3–200, trimmed), description: string(10–10 000, trimmed) }` (`bookId` must be present; `null` = general ticket).
* `201 { ticket: Ticket }` (status `OPEN`, category/priority/assignee `null`). Side effects: a `PENDING` AI attempt is created in the same transaction, an SSE `ticket.created` event is published, background analysis starts.
* Errors: `400` validation; `404 Book not found` (missing or someone else's); `429` over 30 creations per hour (`Retry-After`).

### `GET /api/v1/author/tickets`

Role: AUTHOR. Query: ticket filters + pagination. `200 { items: TicketSummary[], page, pageSize, total }`, newest first (`createdAt desc, id desc`), own tickets only. `400` for invalid or unknown query keys.

### `GET /api/v1/author/tickets/:ticketId`

Role: AUTHOR. `200 { ticket: Ticket, messages: AuthorMessage[] }` (only `AUTHOR`-visible messages, ascending). `404` for missing or foreign.

### `GET /api/v1/admin/tickets` (admin queue)

Role: ADMIN. Query: ticket filters + pagination. `200 { items: TicketSummary[], page, pageSize, total }`. Order: unresolved (`OPEN`, `IN_PROGRESS`) first; among them highest priority first (`CRITICAL`…`LOW`, unclassified last) then oldest first; resolved/closed follow, most recently updated first; id breaks ties. Ordering uses raw SQL, then rows are loaded by id.

### `GET /api/v1/admin/tickets/:ticketId`

Role: ADMIN. `200 { ticket, author: AuthorProfile, book: Book|null, messages, internalNotes, assignments, aiAnalysis: AiAttempt|null, auditEvents }`. `messages` include all visibilities; `auditEvents` are the latest 100 (oldest first after reversal) without raw before/after JSON. `404` if missing.

### `PATCH /api/v1/admin/tickets/:ticketId`

Role: ADMIN. Body: any of `{ status, category, priority }` (at least one key required, enum values). `200 { ticket }`. Transaction: lock row, validate transition, update, one audit row per changed field. Errors: `400`; `404`; `409` `Cannot change status from X to Y` (illegal transition, includes any change from `CLOSED`) or `Closed tickets cannot be modified` (category/priority on a closed ticket). Sending only unchanged values is a no-op returning `200`. Publishes SSE `ticket.updated` when something changed.

## 10.7 Messages

### `POST /api/v1/author/tickets/:ticketId/messages`

Role: AUTHOR. Body `{ body: string(1–10 000, trimmed) }`. `201 { message: AuthorMessage }`. Always creates an `AUTHOR`-visible message; a duplicate identical body from the same author within 60 s returns the original (still `201`). Errors: `404` missing/foreign; `409 Closed tickets cannot receive replies`; `429` over 60 per hour. Writes audit `ticket.author_reply.created`, bumps `updatedAt`, publishes `ticket.reply.created`.

### `POST /api/v1/admin/tickets/:ticketId/replies`

Role: ADMIN. Body `{ body }` as above. `201 { message: AuthorMessage }` (visible to the author). Same duplicate rule (60 s). `404`; `409` if `CLOSED`. Audit `ticket.reply.created`; publishes `ticket.reply.created`. This is the only route by which an AI draft (after human editing) can reach an author.

## 10.8 Admin-only ticket operations

### `POST /api/v1/admin/tickets/:ticketId/internal-notes`

Body `{ body }`. `201 { note }`. Immutable, never returned by any author route; duplicate rule (60 s); audit `ticket.internal_note.created`; SSE `ticket.updated` to admins only. `404`. (Accepted even on a `CLOSED` ticket.)

### `PUT /api/v1/admin/tickets/:ticketId/assignment`

Body `{ assigneeId: string|null }`. `200 { ticket, assignment }`. `assigneeId` must be the caller's own id or `null` (unassign), else `403 Tickets can only be assigned to yourself`. `409` if `CLOSED`, or if unassigning a ticket that was never assigned. An unchanged assignment is an idempotent no-op returning the latest history row. Audit `ticket.assignment.updated`.

## 10.9 Attachments

Allowed content types: `application/pdf`, `image/png`, `image/jpeg`, `image/webp`, `text/plain`. Limits (configurable): 5 MiB per file, 5 per ticket.

### `POST /api/v1/author/tickets/:ticketId/attachments?filename=<name>`

Role: AUTHOR. Request body: **raw file bytes**; `Content-Type` is the file's declared type; `filename` query parameter is the display name (sanitised: no directories, control or shell-significant characters, ≤ 120 chars). `201 { attachment: Attachment }` (storage key never returned). Errors: `400` unsupported type, missing filename, empty body, oversize (body-parser "too large" is mapped to 400), content not matching declared type (magic bytes); `404` missing/foreign ticket; `409` ticket `CLOSED` or already 5 attachments.

### `GET /api/v1/author/tickets/:ticketId/attachments` and `GET /api/v1/admin/tickets/:ticketId/attachments`

`200 { items: Attachment[] }` ascending by creation. Author: own tickets; admin: any ticket. `404`.

### `GET /api/v1/author/tickets/:ticketId/attachments/:attachmentId` and `GET /api/v1/admin/tickets/:ticketId/attachments/:attachmentId`

`200` with the file bytes. Headers: `Content-Type` (stored), `Content-Length`, `Content-Disposition: attachment; filename="…"; filename*=UTF-8''…`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`. `404` if the attachment does not belong to that ticket (and, for authors, that ticket to the caller) or the file is missing on disk.

## 10.10 AI (admin only)

### `GET /api/v1/admin/tickets/:ticketId/ai-analysis`

`200 { analysis: AiAttempt | null }`, the latest attempt, `null` if none. `404`. Authors can never read this.

### `POST /api/v1/admin/tickets/:ticketId/ai-analysis`

No body. Starts or joins an analysis. `202 { analysis }` while the returned attempt is `PENDING`; `200 { analysis }` if it is already terminal (for example inside the 30 s cooldown). `404`; `409 Closed tickets cannot be analysed`. Audit `ticket.ai_analysis.requested` only when a new attempt is created. Never sends anything and never changes the ticket.

## 10.11 Events (Server-Sent Events)

### `GET /api/v1/events/tickets`

* Role: any signed in (author needs a profile, else 403). Response `200 text/event-stream; charset=utf-8`, headers `Cache-Control: no-store, no-transform`, `X-Accel-Buffering: no`. First bytes: `retry: 5000` and a `: connected` comment.
* Events: `ticket.created`, `ticket.updated`, `ticket.reply.created`, `ticket.analysis.updated`. Frame: `id: <epoch-ms>-<n>`, `event: <name>`, `data: {"ticketId","occurredAt","version"}`. No ticket content.
* Delivery rules: admins receive every event; an author receives only `audience: all` events for their own tickets. AI and internal-note events are admin-only.
* Reconnect: send `Last-Event-ID` (or `?lastEventId=`); the server emits a `ticket.updated` for every in-scope ticket whose `updatedAt` ≥ that time (up to 200; a truncation comment follows if the cap is hit). Delivery is at-least-once; `(ticketId, version)` is the idempotency key.
* Keep-alive every 25 s (`: ping`); the stream is closed when the session expires or is revoked (logout closes it immediately). Max 5 concurrent streams per user (`429` + `Retry-After: 30`). A client that stops reading (> 1 MB buffered) is disconnected.
* Process-local: after an API restart live pushes are lost; clients fall back to polling.

## 10.12 OpenAPI specification and what is verified

[`openapi.yaml`](openapi.yaml) (OpenAPI 3.1) describes the 24 operations above. Method, path, role, request-body schemas and success/error status codes were taken from the route handlers and the Zod contracts. Items **not verifiable from source alone**, marked `x-unverified` in the file where relevant: the exact set of headers Helmet adds to API responses; the precise `details` array for validation errors (paths and Zod messages vary); `Content-Length` on streaming responses; Traefik-added headers (HSTS) which are outside the application. The specification was parsed and validated with a local OpenAPI validator as described in [15 – Testing Architecture](15-TESTING-ARCHITECTURE.md) §15.8 (see the result recorded there).
