# End-to-end test report

Revision under test: `88cad7a` (clean container builds) plus the local uncommitted work described in [BUG_REGISTER.md](BUG_REGISTER.md).
Live target: https://bookleaf.77.37.45.177.sslip.io, synthetic accounts only. Results were produced on 2026-10-15/16.

## 1. Automated suites (clean Linux containers built from the repository)

| Suite | Env | Passed | Failed | Skipped | Duration | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Typecheck (all workspaces + e2e project) | Node 22 / 24 | pass | 0 | - | - | exit 0 |
| Production build (contracts, db, ai, api, web) | Node 22 / 24 | pass | 0 | - | - | exit 0 |
| AI package (vitest) | Node 22 | 456 | 0 | 0 | 2.5 s | 10 files |
| AI package | Node 24 | 456 | 0 | 0 | 1.3 s | 10 files |
| API with real `@bookleaf/ai`, mocked provider, embedded PostgreSQL | Node 22 | 227 | 0 | 0 | 49.9 s | 13 files, absolute `BOOKLEAF_AI_ENTRY` |
| API (same) | Node 24 | 227 | 0 | 0 | 42.6 s | 13 files |
| Web unit (vitest, jsdom) | Node 22 | 46 | 0 | 0 | 8.5 s | 7 files, run on the committed revision |
| Web unit | Node 24 | 46 | 0 | 0 | 4.3 s | 7 files |
| Scaffold (`node --test`) | Node 22 / 24 | 9 | 0 | 0 | <1 s | |
| Infra mock tests | Node 22 / 24 | 12 | 0 | 0 | <1 s | |
| Playwright E2E (Chromium, disposable stack) | Node 22 | 30 | 0 | 0 | 27.5 s | |
| Playwright E2E | Node 24 | 30 | 0 | 0 | 28.3 s | after repairing a corrupt browser in the test image (H-1); the first attempt had 4 failed / 11 not run |
| `git diff --check` | host | clean | - | - | - | only LF/CRLF notices |
| Compose validation | host | base and base+demo+tools valid | - | - | - | 0 published ports; base services `db api web` |
| Dependency audit | host | see [SECURITY_AUDIT.md](SECURITY_AUDIT.md) | | | | |

Local work after those runs (uncommitted): `apps/web` suite **48 passed** (46 + 2 new `dashboard-counts` tests that failed before the fix and pass after), `tsc` clean, production build clean. The full cross-version matrix has not been repeated on that working tree.

## 2. Live API (all 24 operations)

`tests/live/api-matrix.mjs`: **139/139 passed**, 2 known issues reported (BUG-001, BUG-002). Per operation: valid and invalid body, invalid query
keys and ranges, missing authentication (401), wrong role (403), cross-author ids (404), malformed ids (never 5xx), duplicate/concurrent
requests, mass-assignment attempts, and every response validated against the Zod contracts used by the frontend. All bodies were scanned
for password hashes, token hashes, storage keys, stack traces and framework names: none found.

## 3. Live browser journeys

| Script | Result |
| --- | --- |
| `ui-journey.mjs` (create ticket + attachment, download, reply, admin queue/assign/status/note, AI panel, edited reply, admin download, role block, logout) | 16/16 |
| `ui-forms.mjs` (login validation, protected routes, back/forward, form validation, empty/loading/error states, admin filters and pagination) | 18/21 as first run; the 3 misses were my test's state leakage (2) and a real LOW finding (BUG-005). Follow-up probes recorded the actual behaviour: invalid email -> server message; empty password -> client message; authenticated `/login` -> form still shown |
| `ux-sweep.mjs` (5 viewports x 11 page/role combinations = 55) | no horizontal overflow, console errors, failed requests or broken text. Not checked: pixel-level visual quality, keyboard/screen-reader use |
| `sse-browser.mjs` | 5/5 (details in section 4) |
| `audit-live.mjs` | 46/47 (the miss is the documented wrong assumption about `IN_PROGRESS -> OPEN`, which the code allows on purpose) |
| `closed.mjs` | 7/7 |
| `browser.mjs`-style auth checks | 19/19 (previous round, same code) |

Audit history: the admin ticket view lists all 6 audit events produced by the actions (reply, status, priority, assignment, note, author reply).

## 4. Real-time behaviour (observed, not benchmarked)

* Admin reply to visible text on an open author page: 95, 98, 97, 101, 103 ms (5 samples); two simultaneous sessions 94 and 93 ms.
* Each message appears exactly once, live and after refresh.
* Network drop of about 6 s: the missed reply appeared 17.3 s after the connection returned.
* Polling fallback (`EventSource` removed): update visible after 25.0 s, matching the 25 s heartbeat.
* Another author's open session never showed this ticket's content, live or by direct URL; raw SSE streams of a second author received nothing about it.

## 5. What was not covered

Real OpenRouter inference; Firefox/Safari; load and capacity; accessibility tooling; certificate renewal; browser tests of the dashboards after the local fix (the fix is covered by unit tests only and is not deployed).
