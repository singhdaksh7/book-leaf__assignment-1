# Security audit

Non-destructive testing of owned local and staging environments, 2026-10-15/16, revision `88cad7a`. No aggressive scans, load or stress
tests were run against the live VPS. Severity: CRITICAL / HIGH / MEDIUM / LOW / INFO. **No CRITICAL or HIGH finding in the application.**

## 1. Controls verified

| Area | Result | Evidence |
| --- | --- | --- |
| Password hashing | argon2id for all 11 users; hashes never returned by any endpoint | DB prefix check; 139-check matrix scans every body for hash/token fields |
| Session cookie | `HttpOnly; Secure; SameSite=Lax`, Expires = 168 h; only the SHA-256 of the token is stored | live Set-Cookie; `sessions.ts` |
| Session expiry / revocation | logout deletes the row; replaying the old cookie returns 401; login prunes expired rows and caps 10 per user; expiry also enforced server side | live replay test; E2E 10 (expiry forced in the database); 33 rows, 0 expired |
| CSRF and Origin | missing/forged `X-CSRF-Token` 403; foreign `Origin` 403 (including login); CORS echoes only the configured origin | matrix; audit script |
| Authentication | anonymous API and SSE 401; forged cookie 401; extra fields (`role`, `isAdmin`) cannot elevate | matrix |
| Authorization (RBAC) | author on `/admin/*` 403; admin on `/author/*` 403 (no author profile); the UI shows "Access Restricted" and calls no admin API | matrix; UI check |
| Cross-author isolation / IDOR | other author's ticket, book, attachment list/download, messages: 404; ticket against another author's book 404; list never contains foreign tickets; SSE streams carry only the owner's events | matrix; audit script; browser test |
| Input validation | Zod on every body and query; unknown keys, bad ranges, wrong types, oversize JSON (100 kB) rejected; form-encoded login body rejected | matrix (139 checks) |
| SQL injection | login payload `' OR 1=1 --@x.test`, ids `'; DROP TABLE "Ticket";--`, `../../etc/passwd`, 300-char and NUL ids all return 4xx, never 5xx; queries are parameterised (Prisma / `$queryRaw` tagged templates) | matrix; code review of raw queries |
| XSS | stored payloads (`<img onerror>`, `<script>`) in ticket subject/description rendered inert in a real browser; React escaping; CSP `script-src 'self'` | audit script, browser DOM check |
| Uploads | allow-list (PDF, PNG, JPEG, WebP, text), magic-byte check, 5 MiB, 5 per ticket; `.exe`, SVG, HTML-as-PNG, NUL-byte text, 5 MiB + 1 rejected; `../`, `..\`, `a/b/c.txt` reduced to a bare name; random storage keys; forced download with `nosniff` | audit script; UI upload tests |
| Rate limiting | 10 failures per (IP, account) and 30 per IP in 15 min -> 429 `Retry-After: 900`; stays blocked; other accounts unaffected; ticket (30/h) and message limits exist | live; limiter code. In memory, single instance |
| Transport and headers | valid Let's Encrypt certificate (to 2027-01-13); HTTP -> HTTPS 301; HSTS 31,536,000 s; CSP `default-src 'self'` + `frame-ancestors 'none'`; nosniff; X-Frame-Options; Referrer-Policy; no `X-Powered-By` | live header checks |
| Secrets | none in the repository (pattern scan of tracked files: only a fake key in an injection test); `.env` mode 600 on the server; no secrets, ticket text or e-mails in API, web, DB, mock or Traefik logs | scans |
| Error handling | errors use a fixed JSON contract with a request id; a database outage returned `500 INTERNAL_ERROR` with no internals; no stack traces or framework names in any response | outage test; matrix |
| Network exposure | only 22/80/443 open (ufw); PostgreSQL, API, mock and web publish no host ports; ports 8080, 3000, 5432, 3100, 6379 unreachable from outside; database on an `internal: true` network | external probe; `ss`; compose |
| AI prompt privacy | provider requests exclude author identity, ISBN, financial data and internal notes; digit runs masked; injection hardening; ungrounded/invented figures rejected | E2E `9b` (exact bytes inspected), AI package security tests (passed on Node 22/24) |

## 2. Findings

| ID | Severity | Finding | Recommendation |
| --- | --- | --- | --- |
| BUG-006 | MEDIUM | No scheduled or off-host backups | add a schedule, retention and an off-host copy |
| BUG-003 | LOW | `DELETE` on `InternalNote` / `TicketAssignment` is not blocked by trigger (needs database access; the API has no route) | migration sketched in the bug register |
| BUG-011 | LOW | `npm audit --omit=dev`: 3 high, one Prisma-CLI chain (`deepmerge-ts` < 8, stack exhaustion on recursive objects). Not imported by the server; only the migrate job runs the CLI on trusted config. No non-breaking upgrade exists | accept, or plan a Prisma 8 upgrade; do not apply an override blindly |
| BUG-012 | LOW | author payloads include `assigneeId` | omit for authors in a future contract change |
| BUG-001 | LOW | email with surrounding whitespace rejected at login | trim before validating |
| BUG-016 | INFO | the API image carries dev dependencies (needed for Prisma CLI/`tsx`); the full tree has 13 advisories (2 critical in `vitest`/`tinypool`, dev-only) | slimmer runtime image |
| S-5 | INFO | throttling and rate limits are per process | needs a shared store before scaling out |
| S-6 | INFO | API container has internet egress (needed for OpenRouter) | by design |
| BUG-014 | INFO | host: pending reboot, 23 security-related upgrades | owner/host maintenance |

`assigneeId` assessment: it comes from the shared `ticketSchema`. Only admin pages use it (queue and detail). It is an opaque cuid that tells an author only whether staff have taken the ticket, so the information exposed is minimal and arguably useful; it is not required by any author page and can be dropped later with an author-specific schema.

## 3. Dependency audit (2026-10-16)

* Production (`npm audit --omit=dev`): 3 high, all one chain. `@prisma/client` 6.19.3 has no dependencies; the vulnerable `deepmerge-ts` 7.1.5 is pinned by `@prisma/config` in every Prisma 6.x and 7.x release up to 7.10.0, and the only fixed line is a major 8.x prerelease. The lockfile was not modified; a dry run confirmed this.
* Full tree: 13 (3 moderate, 8 high, 2 critical), all dev tooling (`vitest`, `tinypool`, `braces`/`micromatch`, `chokidar`, `tailwindcss` helpers). They are not executed in production; fixing them needs major test-runner upgrades.

## 4. Not tested

Authenticated fuzzing at scale, TLS configuration scanning, denial-of-service resistance, the shared Traefik instance, host hardening, penetration testing by a third party.
