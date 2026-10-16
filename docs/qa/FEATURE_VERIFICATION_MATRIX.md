# Feature verification matrix

Derived from the source (routes, components, Prisma schema), not from earlier documents. "Automated" cites the repository suites;
"Live" cites checks run against https://bookleaf.77.37.45.177.sslip.io with synthetic accounts (scripts in `tests/live/`). A blank
would mean unverified; none are blank. Bug ids refer to [BUG_REGISTER.md](BUG_REGISTER.md).

| # | Feature | Frontend | API | Tables | Authorization | Automated | Live | Deployed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F01 | Sign in | `LoginPage` | `POST /auth/login` | User, Session | public; throttled | API auth/hardening tests; E2E 1 | wrong password 401, validation, case-insensitive email, throttle 429 at the 11th failure (BUG-001, BUG-010) | yes |
| F02 | Session check and persistence | `AuthContext` | `GET /auth/me` | Session, User | any signed-in user | API auth tests; E2E 10 | survives reload; forged cookie 401 | yes |
| F03 | Sign out / revocation | navbar/sidebar button | `POST /auth/logout` | Session | signed-in; CSRF | API auth tests; E2E 10b | logout 204; replayed cookie 401; Back button shows no data | yes |
| F04 | Role-protected routing | `ProtectedRoute`, "Access Restricted" view | n/a (server enforces 401/403) | n/a | AUTHOR vs ADMIN | web auth tests; E2E boundaries | anonymous redirected to login; author at `/admin/*` sees "Access Restricted", no admin API call (BUG-005) | yes |
| F05 | Author dashboard | `author/DashboardPage` | `GET /author/books`, `GET /author/tickets` | Book, Ticket | AUTHOR | web books/tickets tests; `dashboard-counts` | renders at 5 viewports; true active count shown only after the local fix (BUG-004) | yes (fix not deployed) |
| F06 | Books list and detail | `BooksPage`, `BookDetailPage` | `GET /author/books`, `GET /author/books/:id` | Book, AuthorProfile | AUTHOR, own books only | API books tests; E2E 2 | own 2 books, other author's book 404, malformed ids 4xx | yes |
| F07 | Create ticket | `NewTicketPage` | `POST /author/tickets` | Ticket, AiAnalysis (PENDING), AuditLog | AUTHOR, own book only | API tickets tests; E2E 3 | validation 400s, foreign book 404, mass-assignment ignored, UI validation messages, double click sends 1 request (BUG-002) | yes |
| F08 | Ticket history and filters | `TicketsPage` | `GET /author/tickets` | Ticket | AUTHOR, own tickets | API tickets tests | status/pagination filters, invalid query 400, never lists another author's ticket, empty state | yes |
| F09 | Ticket conversation (author) | `TicketDetailPage` | `GET /author/tickets/:id`, `POST .../messages` | Ticket, TicketMessage | AUTHOR, own ticket; no internal data | API conversations tests; E2E 5 | reply persists after reload; no notes/AI/audit in payload; closed ticket 409 | yes |
| F10 | Attachments (author) | `NewTicketPage`, `TicketDetailPage` | `POST/GET .../attachments`, `GET .../attachments/:id` | TicketAttachment, volume | AUTHOR own ticket; ADMIN | API attachments tests; E2E 4 | byte-identical download; `.exe`, SVG, HTML-as-PNG, NUL bytes, 6 MiB rejected; traversal names neutralised; 5-per-ticket limit; forced-download headers | yes |
| F11 | Admin dashboard | `AdminDashboardPage` | `GET /admin/tickets` | Ticket | ADMIN | web admin tests; `dashboard-counts` | renders; showed wrong totals above 50 tickets (BUG-004) | yes (fix not deployed) |
| F12 | Admin queue: filters, pagination, search | `AdminQueuePage` | `GET /admin/tickets` | Ticket | ADMIN | API admin tests; web admin tests | status/priority/category filters, empty state, Next/Previous; search is current-page only (BUG-013) | yes |
| F13 | Admin ticket detail | `AdminTicketDetailPage` | `GET /admin/tickets/:id` | Ticket, TicketMessage, InternalNote, TicketAssignment, AiAnalysis, AuditLog | ADMIN | API admin tests; E2E 6 | opens by id; contract-valid payload | yes |
| F14 | Change status / priority / category | detail page controls | `PATCH /admin/tickets/:id` | Ticket, AuditLog | ADMIN; transition table | API admin tests; E2E 6 | 5 invalid-input cases 400; `CLOSED` terminal (409); idempotent repeat | yes |
| F15 | Assign / unassign | "Assign to Me" | `PUT .../assignment` | TicketAssignment, Ticket | ADMIN, self only | API admin tests; E2E 6 | assign self, unassign, other user 403, nonexistent 404 | yes |
| F16 | Internal notes | notes form | `POST .../internal-notes` | InternalNote | ADMIN; never to authors | API tests; E2E 7 | author sees no note text (API and UI); author 403 | yes |
| F17 | Admin reply | reply box | `POST .../replies` | TicketMessage, AuditLog | ADMIN | API conversations tests; E2E 9 | author receives it live; closed ticket 409 | yes |
| F18 | Admin attachment access | download buttons | `GET /admin/tickets/:id/attachments[/:id]` | TicketAttachment | ADMIN | API attachments tests | admin downloads identical bytes; author 403 | yes |
| F19 | AI analysis and draft (human review) | AI panel, "Insert Draft into Reply Box" | `GET/POST .../ai-analysis` | AiAnalysis | ADMIN; never sent automatically | AI 456, API real-package tests, E2E 8-9b | 6 categories x classify+draft, labels, no amounts, nothing auto-sent, retry after failure, 6 parallel requests collapse to one attempt. **Mock provider only** | yes (demo mock) |
| F20 | Audit history | "Audit Log & Lifecycle Events (n)" | part of `GET /admin/tickets/:id` | AuditLog | ADMIN | API tests; DB trigger tests | 6 events in API and UI; payloads hold ids and enums only | yes |
| F21 | Live updates (SSE + polling) | `ticketEventManager` | `GET /events/tickets` | none (events are in memory) | per-user audience | API events tests; web SSE tests | 93-103 ms; two sessions; no duplicates; catch-up after a ~6 s drop; polling fallback 25.0 s; cross-author streams isolated | yes |
| F22 | Login throttling and rate limits | error message on login | in `/auth/login`, ticket and message routes | none (memory) | n/a | API hardening tests | 429 with `Retry-After: 900`; other accounts unaffected | yes |
| F23 | Health endpoint | n/a | `GET /healthz` | none | public | API tests | 200; liveness only (BUG-008) | yes |
| F24 | Synthetic seed / import | n/a (CLI job) | n/a | AuthorProfile, Book, User | operator | API seed tests; scaffold | 10 authors, 18 books seeded on staging | yes |
| F25 | HTTPS reverse proxy and deployment | n/a | Traefik labels | n/a | n/a | compose validation | certificate, redirect, HSTS, CSP, no published ports | yes |
| F26 | Demo AI mock (opt-in) | n/a | local `/chat/completions` on 127.0.0.1 | none | requires `MOCK_AI_ACK` | `infra/mock-ai` tests (12) | recovers from API restart, recreate, crash, outage | yes |

Not implemented (so not tested, and not claimed): e-mail delivery, password reset/registration (accounts are seeded), file deletion, ticket reopen after close, server-side admin search, author-facing notifications beyond live page updates.
