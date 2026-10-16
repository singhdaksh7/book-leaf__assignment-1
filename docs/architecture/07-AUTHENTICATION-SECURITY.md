# 7. Authentication and Security Architecture

**Model implemented: server-side sessions with an opaque random cookie, plus a session-bound CSRF token.** There is no JWT, no refresh token, no OAuth/OIDC and no API key authentication anywhere in the source. Passwords are verified with Argon2id; the session is a row in PostgreSQL.

## 7.1 Login and session creation

```mermaid
%% file: auth-sequence.mmd
sequenceDiagram
    autonumber
    participant B as Browser (SPA)
    participant T as Traefik (TLS)
    participant A as Express (authenticate, csrfProtection)
    participant L as Auth router POST /auth/login
    participant DB as PostgreSQL

    B->>T: POST /api/v1/auth/login {email, password}, Origin: https://host
    T->>A: forward (HTTP, X-Forwarded-For)
    A->>A: authenticate: no session cookie, so req.auth is empty
    A->>A: csrfProtection: anonymous request, passes through
    A->>L: route
    L->>L: assertTrustedOrigin (Origin must equal WEB_ORIGIN)
    L->>L: Zod: valid email, non-empty password, email trimmed and lower-cased
    L->>L: throttle check (per IP+account and per IP), else 429 Retry-After
    L->>DB: SELECT User by email, include AuthorProfile
    L->>L: Argon2id verify against stored hash, or against a dummy hash if the email is unknown
    alt unknown email or wrong password
        L->>L: record failure for IP and account
        L-->>B: 401 UNAUTHENTICATED "Invalid email or password" (same message and similar timing)
    else credentials valid
        L->>L: reset the account failure counter
        L->>L: token = 32 random bytes (base64url)
        L->>DB: INSERT Session(tokenHash = SHA-256(token), userId, expiresAt = now + TTL)
        L->>DB: keep newest 10 sessions for the user, delete expired and older ones
        L-->>B: 200 {user}, Set-Cookie bookleaf_session = token (HttpOnly, Secure in production, SameSite=Lax, Path=/, Expires)
        L-->>B: Set-Cookie XSRF-TOKEN = HMAC(SESSION_SECRET, "csrf:" + sessionId) (not HttpOnly, same flags)
    end
```

Facts, all from `auth/routes.ts`, `auth/sessions.ts`, `auth/middleware.ts`:

* **Password hashing:** Argon2id via the `argon2` package, `memoryCost 19 456` KiB, `timeCost 2`, `parallelism 1` (OWASP minimum). Verification reads parameters from the stored hash. A malformed hash verifies as `false`, never throws.
* **Timing equalisation:** when the e-mail does not exist, the password is still verified against a lazily created dummy hash, so response time does not reveal account existence. The error message is identical for both failure cases.
* **Session storage:** table `Session`; only the SHA-256 of the cookie token is stored, so a database leak does not yield usable sessions. Lifetime `SESSION_TTL_HOURS` (default 168, max 2 160); fixed, not sliding. Opportunistic clean-up on each login for that user (expired rows dropped, at most 10 live sessions kept; the oldest are revoked and their event streams close at the next heartbeat). Users who never log in again keep their expired rows.
* **Cookies:** names `bookleaf_session` (HttpOnly) and `XSRF-TOKEN` (readable by JavaScript by design so the SPA can echo it). Both: `Secure` when `NODE_ENV=production`, `SameSite=Lax`, `Path=/`, `Expires` = session expiry. The release audit confirmed these flags on the live HTTPS site.
* **Login throttling:** 10 failures per (IP, account) and 30 per IP in 15 minutes, in memory (single instance), answered with 429 and `Retry-After` (audit: observed `Retry-After: 900`).

## 7.2 Authenticated API request and role-based authorisation

```mermaid
%% file: auth-request-rbac-sequence.mmd
sequenceDiagram
    autonumber
    participant B as Browser
    participant A as Express middleware
    participant R as Router guard
    participant H as Handler
    participant DB as PostgreSQL

    B->>A: GET /api/v1/author/tickets/T1 (Cookie: bookleaf_session)
    A->>DB: Session by SHA-256(token) with User and AuthorProfile
    DB-->>A: session row
    A->>A: expired? no, so req.auth = {sessionId, user{id,email,role}, authorProfile}
    A->>R: requireAuthor
    alt role is not AUTHOR or no AuthorProfile
        R-->>B: 403 FORBIDDEN
    else author
        R->>H: handler
        H->>DB: SELECT Ticket WHERE id = T1 AND authorId = session.authorProfile.id
        alt row not found (missing OR belongs to another author)
            H-->>B: 404 NOT_FOUND "Ticket not found" (identical in both cases)
        else row found
            H->>DB: SELECT TicketMessage WHERE ticketId = T1 AND visibility = AUTHOR
            H-->>B: 200 {ticket, messages} (internal notes never queried)
        end
    end
    Note over B,H: Admin routes use requireRole("ADMIN"): an AUTHOR session gets 403 on every /admin path, an ADMIN session gets 403 on every /author path.
```

Authorisation rules as implemented:

| Rule | Mechanism |
| --- | --- |
| Author sees only own books, tickets, messages, attachments | `authorId = req.auth.authorProfile.id` is part of every author query; the id comes **only** from the session; list filters are `.strict()` so `authorId` in a query string is rejected; the scope is applied last (`{ ...filterWhere(filter), authorId }`) |
| Foreign resources are indistinguishable from missing ones | 404 with the same message for both (tickets, books, attachments) |
| Creating a ticket against another author's book | Checked inside the creating transaction with `SELECT … FOR SHARE` on the book row, answered `404 Book not found`; the `Ticket_book_author` trigger is a second line of defence |
| Author cannot create internal notes, admin-only messages or AI drafts | The reply schema has only `body`; the route always writes `visibility = AUTHOR`; unknown fields are ignored |
| Admin-only data (internal notes, AI analysis, audit events, other authors' profiles) | Only on `/admin/*` routes (`requireRole("ADMIN")`); author serialisers throw if handed an `ADMIN`-visibility message |
| Admins can assign only to themselves | `PUT …/assignment` returns 403 if `assigneeId` is another user; the database trigger additionally requires the assignee to be an `ADMIN` |
| Live events | `TicketEventHub.canReceive`: admins receive everything; an author receives only `audience: "all"` events for their own `authorProfileId`; AI and internal-note events are `audience: "admin"` |

## 7.3 CSRF validation and origin checking

```mermaid
%% file: auth-csrf-sequence.mmd
sequenceDiagram
    autonumber
    participant B as Browser SPA
    participant C as csrfProtection middleware
    participant H as Route handler

    B->>B: read XSRF-TOKEN cookie (JavaScript-readable)
    B->>C: POST /api/v1/author/tickets with session cookie, Origin, X-CSRF-Token
    C->>C: method is safe (GET, HEAD, OPTIONS) or request anonymous?
    alt safe or anonymous
        C->>H: pass through (anonymous requests are rejected later by requireAuth with 401)
    else mutating and authenticated
        C->>C: Origin header present? must equal WEB_ORIGIN, else 403 "Request origin is not allowed"
        C->>C: no Origin but Sec-Fetch-Site is cross-site? 403
        C->>C: expected = HMAC-SHA256(SESSION_SECRET, "csrf:" + sessionId)
        C->>C: constant-time compare with X-CSRF-Token header
        alt mismatch or missing
            C-->>B: 403 FORBIDDEN "Missing or invalid CSRF token"
        else match
            C->>H: next()
        end
    end
```

* The CSRF token is **stateless and bound to the session**: `HMAC(SESSION_SECRET, "csrf:" + sessionId)`. It dies with the session and cannot be derived without the server secret. It is re-issued by `GET /auth/me` so a client that lost the cookie can recover.
* This is a double-submit pattern plus an Origin check. `SameSite=Lax` cookies add a third layer. CORS allows only `WEB_ORIGIN` (credentials on); the audit confirmed a foreign origin gets no CORS allow header.
* **Login CSRF:** there is no session yet, so `POST /auth/login` is protected by `assertTrustedOrigin` alone. Edge case (from reading the middleware order): `csrfProtection` runs *before* the auth router, so a login request that still carries a valid old session cookie must also carry a valid CSRF token or it is rejected with 403.
* **Known gap (documented):** a request with **no** `Origin` header is accepted (non-browser clients send none); for authenticated mutating calls the CSRF token is still required, but the login endpoint then relies on the absence of cross-site context only.

## 7.4 Session validation, refresh and revocation

There is **no refresh flow**. Validity is checked on every request by a database lookup; the session expires at its fixed `expiresAt`.

```mermaid
%% file: auth-session-validation-sequence.mmd
sequenceDiagram
    autonumber
    participant B as Browser
    participant A as authenticate middleware
    participant DB as PostgreSQL
    participant S as SSE stream (events router)

    B->>A: any /api/v1 request with cookie
    A->>A: token length between 20 and 200 characters, else ignored
    A->>DB: find Session by tokenHash
    alt no row or expiresAt <= now
        A->>A: req.auth stays unset, so protected routes answer 401
    else live session
        A->>A: req.auth set (no extension of expiresAt)
    end
    B->>A: GET /auth/me (page load)
    A-->>B: 200 {user} and re-issued XSRF-TOKEN cookie (same expiry)
    loop every 25 s while a stream is open
        S->>DB: SELECT Session by id
        alt row missing or expired
            S-->>B: close the stream
        else valid
            S-->>B: ": ping" comment
        end
    end
```

## 7.5 Logout and session revocation

```mermaid
%% file: auth-logout-sequence.mmd
sequenceDiagram
    autonumber
    participant B as Browser
    participant A as Express (authenticate, csrf)
    participant L as POST /auth/logout
    participant DB as PostgreSQL
    participant H as TicketEventHub

    B->>A: POST /api/v1/auth/logout (cookie + X-CSRF-Token + Origin)
    A->>L: requireAuth passes
    L->>DB: DELETE Session WHERE id = sessionId
    L->>H: closeSession(sessionId), open streams bound to it are closed
    L-->>B: 204 No Content, Set-Cookie clears bookleaf_session and XSRF-TOKEN
    B->>A: replay of the old cookie
    A->>DB: Session by tokenHash, not found
    A-->>B: 401 UNAUTHENTICATED (audit: "logged-out cookie replay returns 401")
```

Revocation paths that exist: logout (this diagram), expiry, and the 10-session cap at login. Paths that do **not** exist: "log out everywhere", admin-initiated revocation, password change or reset (there is no endpoint for either), session revocation on role change.

## 7.6 Unauthorised access rejection

```mermaid
%% file: auth-unauthorized-sequence.mmd
sequenceDiagram
    autonumber
    participant X as Client (anonymous, wrong role or attacker)
    participant A as Express
    participant G as Guards
    participant H as Handler

    X->>A: request to a protected /api/v1 path
    A->>A: authenticate, then csrfProtection
    alt no valid session
        A->>G: requireAuth, requireAuthor or requireRole
        G-->>X: 401 UNAUTHENTICATED "Authentication is required"
    else valid session, mutating request, bad Origin or CSRF token
        A-->>X: 403 FORBIDDEN
    else valid session, wrong role
        G-->>X: 403 FORBIDDEN "You do not have access to this resource"
    else valid session, right role, resource owned by another author
        H-->>X: 404 NOT_FOUND (existence not revealed)
    else too many failed logins or open streams or creations
        A-->>X: 429 RATE_LIMITED with Retry-After
    end
    Note over X,H: Unknown routes under /api/v1 return 404 "Route not found". Error bodies carry only code, message, optional validation paths and the request id.
```

## 7.7 Security controls inventory

| Control | Implemented? | Evidence / note |
| --- | --- | --- |
| Password hashing (Argon2id) | Implemented, tested | `@bookleaf/db/password.ts`; seed hashes with the same function |
| Server-side sessions, hashed token storage | Implemented, tested | `auth/sessions.ts`; E2E checks cookie flags, replay after logout |
| HttpOnly + Secure + SameSite=Lax cookies | Implemented, tested, deployed | E2E `03-production-proxy.spec.ts`; audit on live site |
| CSRF token + Origin validation | Implemented, tested, deployed | E2E `02-boundaries.spec.ts`; audit |
| Role-based authorisation | Implemented, tested, deployed | |
| Cross-author isolation (REST, attachments, SSE) | Implemented, tested, deployed | E2E boundaries; audit |
| Login throttling / per-user write limits | Implemented, tested | In memory, per process |
| Input validation (Zod, strict queries, size limits) | Implemented, tested | |
| Upload restrictions | Implemented, tested, deployed | allow-list of 5 types, magic-byte check, 5 MiB, 5 per ticket, random storage keys, forced download, `nosniff`, `CSP: default-src 'none'; sandbox`; audit rejected HTML-as-PNG, SVG, NUL-byte text, oversize |
| Attachment authorisation | Implemented, tested | Author: attachment must belong to the ticket **and** the ticket to the author; admin: any ticket |
| Secure headers (API) | Implemented, deployed | `helmet()` defaults, `X-Powered-By` removed; `Cache-Control: no-store` on `/api/v1` |
| Secure headers (web) | Implemented, deployed | nginx: CSP (`default-src 'self'`, `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`; HSTS added by Traefik |
| TLS termination | Deployed | Traefik with Let's Encrypt (HTTP-01); the audit recorded issuer and expiry; **renewal was not observed** |
| Prompt-injection and PII defences for AI | Implemented, tested | [09](09-AI-ARCHITECTURE.md) |
| Audit trail, append-only | Implemented, tested | DB trigger |
| Log hygiene (no bodies, headers, cookies, secrets) | Implemented, audited | audit §7 |
| Rate limiting across replicas, MFA, password reset, account lockout notices, antivirus scanning, e-mail verification | **Not implemented** | See [17](17-KNOWN-LIMITATIONS.md) |

## 7.8 Secrets management

* All secrets are environment variables: `SESSION_SECRET` (≥ 32 characters; the API refuses placeholder-looking values in production), `POSTGRES_PASSWORD`, `OPENROUTER_API_KEY`, and the seed passwords. The API's `config.ts` error messages name variables, never values.
* Compose uses `${VAR:?message}` so a missing required value stops `docker compose up`. On the VPS the `.env` file is mode 600 and not in the repository; `.env.example` ships empty values. The release audit scanned tracked files for secret patterns (only a deliberately fake key inside a prompt-injection test was found).
* `OPENROUTER_API_KEY` is wrapped in a `Secret` class in `@bookleaf/ai` whose `toString`, `toJSON` and inspect output are `[REDACTED]`. The provider client sets `redirect: "error"` so the bearer token can only go to the configured host.
* The confidential source dataset is git-ignored and excluded by `.dockerignore`; the seed job reads only `data/synthetic_seed.json`.
* No secret manager (Vault, cloud KMS) is used; rotation is manual (edit `.env`, recreate containers).
