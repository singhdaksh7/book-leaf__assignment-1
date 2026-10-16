# Security and dependency review (final QA)

Scope: integration branch `integration/bookleaf-fullstack`, reviewed on Windows 11 / Node 24.6 with a disposable stack. Evidence is the automated suites listed in [Testing](TESTING.md) unless stated otherwise.

## Dependency audit

`npm audit --omit=dev` -> **3 high**, one chain:

```
deepmerge-ts < 8.0.0 (GHSA-ggr8-5vv4-36mx, stack exhaustion when merging recursive object graphs)
  <- @prisma/config 6.19.3 (pins deepmerge-ts 7.1.5 exactly)
    <- prisma 6.19.3 (CLI; devDependency of @bookleaf/db)
```

- **Reachability**: the advisory needs a recursive object graph merged by `deepmerge-ts`. In this repository it is used only by the Prisma CLI while loading Prisma config during `prisma generate` / `migrate`. It is not loaded by the API or the web app at runtime, and no untrusted input reaches it. Practical risk: negligible.
- **Non-major remediation**: none within Prisma. 6.19.3 is the newest 6.x and still pins deepmerge-ts 7.1.5 (checked on the npm registry); the fix in Prisma itself is a newer major line (7.x/8.x), which was **not** applied.
- **Optional workaround tested in isolation (not applied)**: an npm override `"overrides": { "deepmerge-ts": "^8.0.0" }` in the root `package.json`. In a scratch project with `prisma`/`@prisma/client` 6.19.3 it installed deepmerge-ts 8.0.2, `prisma validate` and `prisma generate` ran without error and `npm audit --omit=dev` reported 0 vulnerabilities. It was not tested with `migrate deploy` or the full suites, and it forces an untested major of a transitive dependency, so it needs an owner decision. Recommendation: accept the risk for submission, or apply the override and re-run the full matrix.
- Dev-only advisories (vitest/tinypool, postcss-selector-parser, ...) appear in plain `npm audit`; they are not shipped and need major upgrades (`--force`), so they were left alone.

## Verified controls

| Area | Result | Evidence |
| --- | --- | --- |
| Sessions | HttpOnly, SameSite=Lax cookie; `Secure` in production behind `TRUST_PROXY`; expiry enforced server-side (API 401, UI redirect); logout revokes server-side, a replayed cookie gets 401 | E2E 10, 10b, 03-production-proxy |
| CSRF | Mutations need `X-CSRF-Token` (session-bound HMAC) **and** a trusted Origin; foreign-origin mutation and login-CSRF refused; CORS echoes only the configured origin | E2E 02-boundaries, API `auth`/`hardening` tests |
| Authorization | Author/admin separation in UI and API (403); cross-author access to tickets, messages, attachment list/download/upload returns 404; no admin fields (notes, AI analysis, audit, storage keys, hashes) in author payloads | E2E 02-boundaries, 7 |
| Internal notes | Never visible to authors in UI or API; DB triggers protect `InternalNote` and `AuditLog` | E2E 7, API tests |
| Attachments | Allow-list of 5 types verified by magic bytes (an HTML body declared as `image/png` is refused, NUL bytes in `text/plain` refused), 5 MiB limit, 5 per ticket, sanitized display name (no path components), random storage keys outside any served path, ownership in the lookup, downloads always `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff` | E2E 02-boundaries |
| AI data minimisation | Provider requests contain ticket subject/description (digits masked), policy excerpts and non-financial book facts only; no author name/e-mail/phone/city, no ISBN, no royalty/MRP/sales figures, no internal notes | E2E 9b (inspects the exact mock-provider requests), API real-package privacy tests (12/12 when `BOOKLEAF_AI_ENTRY` is set) |
| AI behaviour | AI never sends a message; drafts are inserted into the reply box for an admin to edit and send; ungrounded drafts are rejected (`AI_UNGROUNDED_OUTPUT`) | E2E 8, 9 |
| Logs | Request logs hold method, path (no query), status, timing and user id. A scan of 184 API/web log lines from a full E2E run found no e-mails, passwords, API keys, ticket text, ISBN/phone or financial values | E2E run output scan |
| Production config | Startup refuses placeholder `SESSION_SECRET` and non-https `WEB_ORIGIN`; HSTS and `nosniff` present; no `X-Powered-By` | E2E 03-production-proxy |
| Public registration | `POST /auth/register` is author-only: strict body (a `role`, `isAdmin`, `userId` or `passwordHash` key is a 400), role written server-side as `AUTHOR`, Argon2id, shared password policy, duplicates decided only by the unique index (8 concurrent twins give exactly one 201), generic 409, Origin check, per-IP and global rate limits that count invalid attempts, session created as for login, signed-in callers refused, audit row without secrets. A registered author gets 403 on every admin route and 404 on other authors' records | API `registration.test.ts` (42), web `register.test.tsx` (15), E2E `04-registration` (11) |
| Admin account | No API creates, promotes or modifies an admin; the single admin is managed by a server-side tool that reads credentials from the environment (no defaults), refuses to promote an author and revokes sessions on rotation | API `cleanup.test.ts` (admin tool), `docs/release/ADMIN_ACCOUNT.md` |
| Production data hygiene | The synthetic seed is refused when `NODE_ENV=production` without an explicit acknowledgement; the cleanup tool is dry-run by default, whitelist-only, never selects the admin or an unclassified record, verifies every count before commit and never deletes the append-only audit log | API `cleanup.test.ts` (20), local container rehearsal in the real API image |
| Secrets in repo | `.env*` ignored (only `.env.example` templates tracked); the confidential dataset is git-ignored and was not read or modified | `git status`, `.gitignore` |

## Findings

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| 1 | Low | The login page pre-filled mock demo credentials and a "Quick Reviewer Credentials" panel was compiled into **production** bundles (the values match no seeded account) | **Fixed** in `LoginPage.tsx`: shown and pre-filled only in dev + mock mode; strings no longer present in the production bundle |
| 2 | Test defect | `packages/ai/tests/service.test.ts` used `"999"` as a PII sentinel, which occasionally appears inside the random hex nonce of the `<untrusted-...>` delimiters (failed once in a full run) | **Fixed**: sentinel is now `+999-ZZ-PHONE` (cannot occur in hex) |
| 3 | Low | Author ticket payloads include `assigneeId` (the staff member's internal user id) because the ticket schema is shared with admins | Open; harmless opaque id, consider nulling or omitting it for authors |
| 4 | Info | A mutating request without an `Origin` header is accepted (non-browser clients); the CSRF token is still required | Documented, by design |
| 5 | Info | Rate limits, login throttling, SSE streams and AI single-flight are in memory (single API instance); attachments have no antivirus scan; `TicketMessage` is append-only by convention, not by trigger | Documented in [Known limitations](KNOWN_LIMITATIONS.md) |
| 6 | Info | Graceful `SIGTERM` shutdown exists in `server.ts` but could not be exercised on Windows (signals terminate the process) or Linux (see limitations) | Unverified |
