# 5. Backend Architecture

The backend is a single Node.js process (`apps/api`, Express 4.21, TypeScript, ESM) built from four npm workspaces: `@bookleaf/contracts` (Zod schemas shared with the browser), `@bookleaf/db` (Prisma schema, migrations, password hashing, seed import), `@bookleaf/ai` (AI package) and `@bookleaf/api` itself.

## 5.1 Directory structure (`apps/api/src`)

```text
apps/api/src/
├── server.ts            process entry: load config, connect Prisma, build AI engine, listen, graceful shutdown
├── app.ts               createApp(): middleware order, router mounting, 404, central error handler
├── config.ts            Zod-validated environment -> AppConfig (refuses placeholder secret / http origin in production)
├── db-check.ts          startup assertion that the database encoding is UTF-8
├── auth/
│   ├── routes.ts        POST /auth/login, POST /auth/logout, GET /auth/me
│   ├── middleware.ts    authenticate, csrfProtection, assertTrustedOrigin, requireAuth, requireRole, requireAuthor
│   ├── sessions.ts      token generation, SHA-256 hashing, create/find/revoke session, HMAC CSRF token
│   └── rateLimit.ts     FailureLimiter (in-memory sliding counter)
├── routes/
│   ├── author.ts        books, own tickets, replies, attachments (AUTHOR only)
│   ├── admin.ts         queue, detail, PATCH, replies, notes, assignment, AI, attachments (ADMIN only)
│   └── events.ts        GET /events/tickets (SSE)
├── tickets/
│   ├── transitions.ts   allowed status transition table
│   ├── filters.ts       strict query parsing + Prisma where-builder
│   ├── serializers.ts   field-by-field DTO construction validated by contract schemas
│   └── hooks.ts         optional post-commit hook interface (not wired by server.ts)
├── attachments/
│   ├── validate.ts      type allow-list, magic-byte check, filename sanitiser, Content-Disposition
│   └── storage.ts       AttachmentStorage interface + LocalDiskStorage
├── ai/
│   ├── engine.ts        AiEngine port, adapter over @bookleaf/ai, "unavailable" engine
│   ├── attempts.ts      AiAttemptService: durable attempts, single-flight, retry sweep, concurrency limit
│   └── context.ts       backend privacy allow-list for book context sent to the AI
├── events/hub.ts        TicketEventHub: in-process pub/sub with per-subscriber authorisation
├── http/                errors (AppError), validate (parseInput, asyncHandler), logger, serialize, types
└── serializers.ts       Book / AuthorProfile / current-user DTOs
```

There is no separate "controller" or "service" folder. Route modules play the controller role and contain the transaction logic inline; reusable rules are extracted into `tickets/*`, `attachments/*`, `ai/*` and `events/*`.

## 5.2 Layered architecture

```mermaid
%% file: backend-architecture.mmd
flowchart TB
    CL["Clients: author and admin browsers via Traefik"]

    subgraph L1["Layer 1 - Transport and cross-cutting middleware (app.ts)"]
        direction LR
        M1["withRequestId<br/>X-Request-Id"] --> M2["accessLog<br/>method, path, status, ms, userId"] --> M3["helmet"] --> M4["cors<br/>origin = WEB_ORIGIN"] --> M5["express.json 100 kB"] --> M6["cookie-parser"]
    end

    subgraph L2["Layer 2 - Security middleware on /api/v1"]
        direction LR
        S1["noStore<br/>Cache-Control: no-store"] --> S2["authenticate<br/>cookie -> session -> req.auth"] --> S3["csrfProtection<br/>Origin + X-CSRF-Token on mutating requests"]
    end

    subgraph L3["Layer 3 - Routers (HTTP controllers)"]
        direction LR
        R1["/auth<br/>login, logout, me"]
        R2["/author<br/>requireAuthor"]
        R3["/admin<br/>requireRole ADMIN"]
        R4["/events<br/>requireAuth, SSE"]
    end

    subgraph L4["Layer 4 - Domain rules and services"]
        direction LR
        D1["tickets/transitions<br/>tickets/filters"]
        D2["attachments/validate<br/>attachments/storage"]
        D3["ai/attempts (AiAttemptService)<br/>ai/engine, ai/context"]
        D4["events/hub<br/>(TicketEventHub)"]
        D5["auth/sessions<br/>auth/rateLimit"]
        D6["serializers<br/>(DTO + Zod parse)"]
    end

    subgraph L5["Layer 5 - Data access"]
        direction LR
        P1["Prisma Client<br/>@bookleaf/db"]
        P2["$queryRaw row locks<br/>FOR UPDATE / FOR SHARE"]
        P3["LocalDiskStorage"]
    end

    subgraph L6["Layer 6 - Persistence"]
        direction LR
        PG[("PostgreSQL 16<br/>checks, triggers,<br/>partial unique index")]
        VOL[("attachments volume")]
    end

    CT["@bookleaf/contracts<br/>Zod schemas used by routers and serializers"]
    AI["@bookleaf/ai<br/>classifier, drafter, provider client"]
    EH["Central error handler<br/>AppError -> JSON error body"]

    CL --> L1 --> L2 --> L3 --> L4 --> L5
    P1 --> PG
    P2 --> PG
    P3 --> VOL
    L3 -. "validate in/out" .-> CT
    D3 --> AI
    L3 -. "throw AppError" .-> EH
```

**Explanation.** Requests flow downward through six layers; each layer talks only to the one below it, with two cross-cutting exceptions: the shared contract schemas (used for both input validation and output construction) and the central error handler. The AI package is reached only through `AiAttemptService` and its `AiEngine` port, so the API starts and operates even if the package or its configuration is missing (`createUnavailableEngine`).

## 5.3 Request lifecycle (browser → database → browser)

```mermaid
%% file: backend-request-lifecycle.mmd
sequenceDiagram
    autonumber
    participant B as Browser
    participant T as Traefik
    participant A as Express app
    participant MW as Middleware (auth, CSRF)
    participant R as Route handler
    participant P as Prisma / PostgreSQL
    participant E as Error handler

    B->>T: HTTPS request with session cookie (and X-CSRF-Token if mutating)
    T->>A: HTTP :3000 (X-Forwarded-* headers, trust proxy = 1)
    A->>A: assign X-Request-Id, start access-log timer
    A->>A: helmet, CORS check, parse JSON (max 100 kB), parse cookies
    A->>MW: noStore, authenticate
    MW->>P: find Session by SHA-256(cookie token) with user and profile
    P-->>MW: session or none (expired = none)
    MW->>MW: csrfProtection (skipped for GET/HEAD/OPTIONS and anonymous)
    MW->>R: requireAuthor or requireRole(ADMIN)
    R->>R: parseInput(Zod schema) for body, query
    R->>P: transaction: SELECT ... FOR UPDATE, write rows, write AuditLog
    P-->>R: committed rows
    R->>R: publish SSE event after commit
    R->>R: serialize to DTO and parse with contract schema
    R-->>A: res.status(...).json(...)
    A-->>T: response (+ X-Request-Id)
    T-->>B: HTTPS response
    A->>A: on finish: log method, path, status, duration, userId
    Note over R,E: Any thrown AppError or unexpected error goes to the error handler,<br/>which returns {error:{code,message,details?,requestId}} and logs only the error class name
```

Step by step:

1. **Entry.** `app.ts` assigns an `X-Request-Id` (a client-supplied value is accepted only if it matches `^[A-Za-z0-9_-]{8,64}$`, otherwise a UUID) and starts the access-log timer. The log line is written on `finish` and contains method, **path only**, status, duration and user id; never query strings, headers or bodies.
2. **Hardening and parsing.** `helmet()` defaults, `cors({ origin: WEB_ORIGIN, credentials: true })`, `express.json({ limit: "100kb" })`, `cookie-parser`. `GET /healthz` is answered here, before authentication.
3. **Authentication** (`v1.use(authenticate)`): reads the cookie `bookleaf_session`, hashes it, looks up `Session` (+ `User` + `AuthorProfile`) and attaches `req.auth` if the session exists and has not expired. It never rejects; routes opt in.
4. **CSRF** (`v1.use(csrfProtection)`): for non-safe methods *when a session exists*, checks the `Origin` header and the `X-CSRF-Token` header (constant-time compare against `HMAC(SESSION_SECRET, "csrf:" + sessionId)`).
5. **Authorisation** inside each router: `requireAuthor` (role `AUTHOR` **and** an `AuthorProfile`), `requireRole("ADMIN")`, or `requireAuth` for `/events` and `/auth/logout|me`.
6. **Validation.** `parseInput(schema, value, label)` runs Zod and throws a `VALIDATION_ERROR` whose details carry paths and generic messages, never submitted values. Query schemas are `.strict()`: unknown keys (for example `authorId`) are rejected, so a client cannot widen the tenant scope.
7. **Business logic and persistence.** State-changing handlers open a Prisma interactive transaction, lock the ticket row with `SELECT … FOR UPDATE` (ownership is part of the author-side lock query), apply rules, write rows and one `AuditLog` row per change, commit.
8. **After commit.** SSE events are published (`events.publish`) and AI work is kicked off; neither can fail the HTTP response.
9. **Serialisation.** Responses are built field by field and parsed with the contract schema (`serializers.ts`, `tickets/serializers.ts`); Prisma rows are never spread into a response. Audit `before`/`after` JSON and `storageKey` are never serialised.
10. **Errors.** `asyncHandler` forwards rejected promises. The central handler maps `AppError` to its HTTP status, maps body-parser `entity.parse.failed` / `entity.too.large` to `VALIDATION_ERROR` (400), and turns anything else into `INTERNAL_ERROR` (500) with a fixed message.

## 5.4 Middleware summary

| Middleware | Where | Behaviour |
| --- | --- | --- |
| `withRequestId`, `accessLog` | app-wide | Correlation id; structured access log |
| `helmet()` | app-wide | Default security headers on API responses; `X-Powered-By` disabled |
| `cors` | app-wide | Allows only `WEB_ORIGIN` with credentials; methods GET, POST, PUT, PATCH, DELETE; headers `Content-Type`, `X-CSRF-Token`, `X-Request-Id`, `Last-Event-ID`; `maxAge` 600 s |
| `express.json` | app-wide | 100 kB limit |
| `express.raw` | attachment upload route only | Only for the five allowed MIME types; limit `ATTACHMENT_MAX_BYTES` (default 5 MiB) |
| `noStore` | `/api/v1` | `Cache-Control: no-store` |
| `authenticate` / `csrfProtection` | `/api/v1` | See §5.3 |
| `requireAuth`, `requireAuthor`, `requireRole` | per router / route | 401 `UNAUTHENTICATED` or 403 `FORBIDDEN` |

## 5.5 Input validation

Zod is the only validation library, and the schemas live in `packages/contracts/src/index.ts` so that the browser and the server share one definition. Highlights: ticket `subject` 3–200 and `description` 10–10 000 characters (trimmed); reply and note `body` 1–10 000; `pageSize` ≤ 100; filter enums for status, category, priority; `from`/`to` coerced dates with `from ≤ to` and inclusive end-of-day for date-only `to`. Environment variables are validated at startup by `config.ts` (names only in error messages, never values).

## 5.6 Authentication and authorisation (overview)

Server-side sessions with an opaque cookie; role checks per router; author data scoped by `AuthorProfile.id` taken from the session only. Details and sequence diagrams are in [07 – Authentication and Security](07-AUTHENTICATION-SECURITY.md).

## 5.7 Error handling

| `AppError` code | HTTP | Typical cause |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Bad body/query, unsupported file type, oversize body |
| `UNAUTHENTICATED` | 401 | No/invalid/expired session; wrong credentials |
| `FORBIDDEN` | 403 | Wrong role, bad Origin, missing/invalid CSRF token, assigning to someone else |
| `NOT_FOUND` | 404 | Missing **or not owned** resource, unknown route (identical response by design) |
| `CONFLICT` | 409 | Illegal status transition, closed ticket, attachment limit, nothing to unassign |
| `RATE_LIMITED` | 429 | Login, ticket-creation, reply or SSE-connection limit (with `Retry-After`) |
| `INTERNAL_ERROR` | 500 | Anything unexpected |

Body shape: `{ "error": { "code", "message", "details"?, "requestId"? } }`. Messages are authored strings; exception text is never copied to the client.

## 5.8 Logging

`createLogger()` writes one JSON object per line to stdout (`time`, `level`, `message`, scalar fields). Callers pass only vetted scalars (ids, status codes, durations, error class names, Prisma error codes). Request bodies, headers, cookies, query strings and exception messages are never logged; the release audit found no generated secret, internal-note text or ticket text in API, web, DB or Traefik logs. Compose rotates container logs with the `json-file` driver (10 MB × 3). There is no metrics endpoint, tracing or log shipping (see [14](14-NON-FUNCTIONAL-REQUIREMENTS.md)).

## 5.9 Rate limiting

All limiters are the in-memory `FailureLimiter` (a per-key counter with a reset time; per process).

| Limit | Key | Default | Source |
| --- | --- | --- | --- |
| Failed logins per account | `IP + email` | 10 per 15 min (`LOGIN_MAX_FAILURES`, `LOGIN_FAILURE_WINDOW_MINUTES`) | `auth/routes.ts` |
| Failed logins per IP | IP | 3 × the above (30) | `auth/routes.ts` |
| Ticket creation | user id | 30 per hour (`TICKET_CREATE_LIMIT_PER_HOUR`) | `routes/author.ts` |
| Author replies | user id | 60 per hour (`AUTHOR_REPLY_LIMIT_PER_HOUR`) | `routes/author.ts` |
| Open SSE streams | user id | 5 | `routes/events.ts` |
| AI refresh | ticket | 30 s cooldown on the latest attempt | `AiAttemptService` |

Admin replies, notes and status changes are not rate limited. Counters reset when the process restarts and are multiplied if more than one API replica runs; the deployment documentation therefore requires a single replica.

## 5.10 File upload processing

`POST /author/tickets/:ticketId/attachments` is a raw-body upload (`Content-Type` = the file's type, `?filename=` = display name). Order of checks: session → CSRF → ownership of the ticket (404 if missing or foreign) → ticket not `CLOSED` (409) → `express.raw` size limit → declared type in the allow-list → filename sanitised → non-empty → size ≤ limit → **magic-byte signature matches the declared type** (PDF `%PDF-`, PNG, JPEG, WebP `RIFF…WEBP`, text must be valid UTF-8 without NUL) → bytes written to disk under a random key → transaction locks the ticket row, enforces the per-ticket maximum (default 5) and inserts the row with the SHA-256. If the transaction fails, the file is deleted. Downloads set `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`. See [08 §8.5](08-TICKET-LIFECYCLE.md) for the lifecycle diagram.

## 5.11 Ticket state transitions

Defined in one table (`tickets/transitions.ts`); admin-only (`PATCH /admin/tickets/:id`). The source comment states this table is the backend's own documented assumption because the original architecture documents named the statuses but defined no transitions.

| From \ To | `OPEN` | `IN_PROGRESS` | `RESOLVED` | `CLOSED` |
| --- | :---: | :---: | :---: | :---: |
| `OPEN` | – | ✔ | ✔ | ✔ |
| `IN_PROGRESS` | ✔ | – | ✔ | ✔ |
| `RESOLVED` | ✔ | ✔ | – | ✔ |
| `CLOSED` | ✘ | ✘ | ✘ | – |

`CLOSED` is terminal: a closed ticket rejects status changes, category/priority changes, replies (author and admin), attachments, assignment changes and AI analysis with `409 CONFLICT`. Notes: an unchanged value is a no-op (HTTP 200, no audit row); author and admin replies do **not** change status; an admin may still add an internal note to a closed ticket (the route has no status check).

## 5.12 AI processing

`POST /author/tickets` writes a `PENDING` `AiAnalysis` row in the same transaction as the ticket and, after commit, calls `ai.kick(attemptId)`; the attempt runs in the background (max 2 concurrent provider runs per process). A recovery timer (every 60 s) abandons stale `PENDING` rows and retries transient failures at most twice. Full detail: [09](09-AI-ARCHITECTURE.md).

## 5.13 Audit trail

Every admin state change and every reply/note writes an `AuditLog` row in the **same transaction** as the change, with actor, action, `entityType = "Ticket"`, `entityId`, before/after values (enum names and ids only), and the request id. The table is append-only by trigger. Admins see the 100 most recent ticket audit events on the ticket detail response (`auditEvents`, without the raw before/after). Events not audited: ticket creation, attachment upload, login/logout, AI completion (only the *request* for an analysis is audited).

## 5.14 Startup and shutdown

Startup (`server.ts`): load `apps/api/.env` if present (development convenience) → `loadConfig()` → `prisma.$connect()` → `assertUtf8Database()` → `loadPackageEngine()` (falls back to the unavailable engine) → `ai.start()` → `listen(PORT)`. Shutdown on `SIGTERM`/`SIGINT`: close all SSE streams, stop accepting connections, stop the AI service (waits for in-flight runs), disconnect Prisma; a 10 s timer forces exit. The graceful path is code-reviewed only (`KNOWN_LIMITATIONS.md`). Uncaught exceptions are logged by class name and terminate the process; the Compose restart policy `unless-stopped` restarts it.
