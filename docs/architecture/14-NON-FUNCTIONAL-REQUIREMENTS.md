# 14. Non-Functional Requirements

The repository does not contain a formal requirements specification with numeric targets. This page records the non-functional
properties the implementation actually provides, the evidence for each, and what was **not** measured. "Observed" means measured
on the single-VPS staging deployment (1 vCPU, 3.9 GiB RAM) with a few dozen synthetic tickets; nothing here is a load or capacity
benchmark, and no benchmark was run.

| Area | Property implemented | Evidence | Status |
| --- | --- | --- | --- |
| Security: authentication | argon2id password hashes; opaque random session token, only its SHA-256 stored; `HttpOnly; Secure; SameSite=Lax` cookie; 168 h lifetime; logout deletes the row; max 10 sessions per user | DB inspection (11/11 hashes `$argon2id$`), live cookie flags and expiry (168 h), logged-out cookie replay returns 401 | Verified |
| Security: request integrity | CSRF token (session-bound HMAC) plus trusted `Origin`; CORS limited to the configured origin; JSON body limit 100 kB | live: missing token 403, foreign origin 403, oversize body 400 | Verified |
| Security: authorization | role checks before routing; author-scoped queries; cross-author access returns 404 | API matrix (139 checks), UI and SSE isolation checks | Verified |
| Security: input handling | Zod validation on every body/query; unknown query keys rejected; upload allow-list with magic-byte check, 5 MiB, 5 per ticket; sanitised file names | API matrix; traversal, HTML-as-PNG, SVG, NUL-byte, oversize uploads all rejected | Verified |
| Security: brute force | 10 failures per (IP, account) and 30 per IP in 15 minutes, then 429 with `Retry-After` | live: 429 on the 11th failure, `Retry-After: 900`; other accounts unaffected | Verified (in memory, single instance) |
| Security: transport | HTTPS only, HTTP 301 to HTTPS, HSTS (31,536,000 s), CSP `default-src 'self'` with `frame-ancestors 'none'`, nosniff, X-Frame-Options, Referrer-Policy | live header checks | Verified |
| Privacy | AI prompts exclude author identity, ISBN, financial data and internal notes | E2E test `9b` inspects the exact bytes sent; API privacy tests | Verified (mock provider only) |
| Integrity | 17 foreign keys, 10 check constraints, 6 triggers, 25 secondary indexes, 0 orphan rows; `AuditLog` append-only | live read-only checks; trigger tests on a disposable database | Verified; `DELETE` on `InternalNote`/`TicketAssignment` is not trigger-protected (BUG-003) |
| Durability | PostgreSQL and attachments on named volumes; data survived API restarts, recreations and a database outage | live and isolated tests | Verified |
| Recoverability | `backup.sh` produces a dump and attachment tarball; restore proven in a disposable container | row-for-row match on 10 tables | Verified. No schedule, no off-host copy, RPO/RTO undefined (BUG-006) |
| Availability | `restart: unless-stopped`, health checks, API survives a database outage without restarting and recovers by itself | isolated test: 0 restarts during outage | Verified on one host; no redundancy, no HA. `/healthz` reports liveness only (BUG-008) |
| Real-time latency | Server-Sent Events, polling heartbeat as fallback | observed 93-103 ms from admin reply to visible text over HTTPS (7 samples); polling fallback surfaced the update in 25.0 s; after a network drop of about 6 s the page caught up 17.3 s after reconnect | Observed, not a benchmark |
| Performance | None specified | Query plans use sequential scans at ~50 rows, which is expected at this size; behaviour at scale not measured | Not measured |
| Scalability | Single API instance by design: login throttling, rate limits, SSE streams and AI single-flight are in memory | code and docs | Known limitation |
| Resource limits | db 512 MiB, api 512 MiB, web 64 MiB; json-file logs 10 MB x 3 | `docker inspect`; observed use db ~35 MiB, api ~120-155 MiB, web ~2 MiB; 0 OOM kills | Verified |
| Compatibility | Node 22 and 24; Chromium/Edge; viewports 1920, 1366, 768, 390, 360 px | clean-container test runs on both Node versions; 55 page/viewport checks with no overflow or console errors | Verified; Firefox/Safari not tested |
| Accessibility | Not specified | Forms use labelled inputs and `role="alert"` messages; no automated accessibility audit was run | Not measured |
| Observability | Structured JSON request logs with request ids; no ticket text, credentials or e-mails in logs | log scans of API, web, database, Traefik | Verified; no metrics, tracing or alerting |
| Maintainability | npm workspaces, shared Zod contracts, 24-operation OpenAPI document matching the routes | cross-check script: 24/24 operations, 11/11 ERD entities, 96 columns, all enum values | Verified |
| Deployability | Reproducible container builds; deployed output identical to a clean build of the commit | compiled-output hash comparison (58 files) | Verified at `3b09980`; image tags do not encode a commit (BUG-007) |
