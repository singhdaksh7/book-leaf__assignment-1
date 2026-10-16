# Known limitations

## Not verified

- **Linux / Docker**: verified after the first QA pass. The unit/API/scaffold suites pass on Node 22 in Docker (Linux), and the `infra/` stack (Dockerfiles, nginx, Compose) was built and deployed as a staging environment. The browser E2E suite itself has only been run on Windows.
- **Real TLS reverse proxy**: verified on the staging deployment (Traefik with a Let's Encrypt certificate: HTTPS, HSTS, `Secure` + `HttpOnly` cookies, CSRF and role isolation checked through the public URL). `03-production-proxy.spec.ts` covers the same behaviour locally behind a plain HTTP proxy.
- **Graceful SIGTERM shutdown** (`apps/api/src/server.ts`) is code-reviewed only.
- **Live OpenRouter**: AI behaviour is verified against a local mock and the real `@bookleaf/ai` package only. No paid call was made. Real-model output quality, latency and cost are untested.
- **Multi-instance deployment**: see below.
- **Browsers**: Chromium and Microsoft Edge (Chromium) only. Responsive layouts were checked at 1920, 1366, 768, 390 and 360 px; Firefox and Safari were not tested.

## By design / accepted for this release

- **Single API instance.** Login throttling, per-author rate limits, SSE streams and AI single-flight are in memory and reset on restart.
- **Same-site deployment required.** The API does not serve the web app; deploy both under one site (for example a reverse proxy: `/` static web, `/api` API) so the `SameSite=Lax` cookie is first-party.
- **Attachments on local disk** under random keys; back them up with the database. No antivirus scanning. Allowed types: PDF, PNG, JPEG, WebP, plain text; 5 MiB; 5 per ticket.
- **`TicketMessage` is append-only by convention** (no edit/delete route), not by database trigger. `AuditLog` is append-only at the database level (update, delete and mass delete are rejected). `InternalNote` and `TicketAssignment` reject `UPDATE` by trigger (assignments allow only the `SET NULL` of a removed assignee), but their triggers do not cover `DELETE`, so a direct SQL delete is not blocked; the API has no delete route for either.
- **A missing `Origin` header is accepted** on mutating requests (non-browser clients); the CSRF token is still required.
- **Author payloads contain `assigneeId`** (opaque staff id) because the ticket schema is shared.
- **No e-mail delivery.** Admin replies appear in the portal (and live over SSE); the UI text mentioning e-mail dispatch is aspirational.
- **The opt-in staging demo AI is not AI.** `infra/mock-ai` returns canned, keyword-matched text labelled `[DEMO MOCK]` / `[DEMO DRAFT]` so the real pipeline and review UI can be shown without a paid provider. It says nothing about real-model quality. Production uses OpenRouter or nothing; it never falls back to canned output. See [Environment](ENVIRONMENT.md).
- **AI is advisory.** Drafts are always reviewed and sent by an admin; if the provider is down or unconfigured tickets still work and the admin sees a failed attempt.
- **Dependency advisories**: 3 high in the Prisma CLI chain (`deepmerge-ts`), unreachable at runtime; see [Security review](SECURITY_REVIEW.md).
- **Engine warnings**: some dependencies declare Node `^22.22.2 || ^24.15.0 || >=26`; older Node only warns.
- **Vite dev server has no `/api` proxy**; set `VITE_API_BASE_URL` (CORS is configured for `WEB_ORIGIN`).
