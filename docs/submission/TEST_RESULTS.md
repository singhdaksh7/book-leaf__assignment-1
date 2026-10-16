# Test results

Run on this branch for the registration release (2026-10-16), Windows 11, Node 24.6, Chrome for E2E. All use synthetic data; **all AI tests use a mock or scripted provider.**

| Suite | Command | Result |
| --- | --- | --- |
| AI package | `cd packages/ai && npx vitest run` | 509 passed (includes regression tests for the real-API findings) |
| API (real Postgres) | `cd apps/api && npx vitest run` | 292 passed, 0 skipped (230 earlier + 42 registration + 20 cleanup, seed guard and admin tool) |
| Web | `cd apps/web && npx vitest run` | 68 passed (53 earlier + 15 registration form) |
| E2E (Playwright, disposable stack) | `cd apps/web && npx playwright test` | 41 passed (30 earlier + 11 registration: desktop, 375 px mobile, keyboard-only) |
| Real API image rehearsal (local) | build `infra/docker/api.Dockerfile`, throwaway PostgreSQL | production-mode seed refused; dry run changed nothing; execute with the token removed the 10 synthetic authors and 18 books and kept the admin and a real author's ticket; admin tool created, refused a duplicate, rotated, refused to promote an author |
| Scaffold | `npm run test:scaffold` | 9 passed |
| Infra (mock AI server) | `npm run test:infra` | 12 passed |
| Typecheck, build | `npm run typecheck`, `npm run build` | clean |
| Backup scripts | manual, disposable containers | backup, restore (550 rows), wrong passphrase, tamper, retention: passed |
| Real OpenRouter acceptance | `node tests/live/ai-real.mjs` | Final prompt, default Nemotron free model: classification 6/6 in every run; drafts passed validation in 12 of 13 analyses (runs of 5/6, 6/6 and 1/1); reported cost 0; account usage 0. A single run can exit 1 on one rejected draft (non-deterministic). Gemma alternative: upstream 429, untested |
| Real provider failures | `node tests/live/ai-real-failures.mjs` | 401, nonexistent model, paid primary and paid fallback (0 requests) and a real 429: all handled as expected, no mock substitution |
| Real OpenRouter, final code (2026-10-16) | script over `createAiServiceFromEnv`, 6 tickets | 12 provider calls per run, 14.8k tokens, reported cost $0, model `nvidia/nemotron-3-super-120b-a12b:free`. Classification and priority 6/6; model drafts accepted 5/6 (book-status draft rejected for an invented timeline, template used). Every analysis has `requiresHumanReview=true`. |
| Production import verification | read-only SQL export vs the assignment JSON | 10 authors, 18 books, **358 field comparisons, 0 mismatches** (14 nulls, 16 zeros, 2 empty `availableOn`, 3 production statuses); 10/10 author logins; My Books counts/ids exact; cross-author access 404; wrong password 401; admin routes 401/403 |
| Production AI smoke (live) | 6 tickets, admin analysis | **All 6 `FAILED` / `AI_RATE_LIMITED`** (free quota exhausted): graceful failure verified (no draft, nothing sent, no AI fields visible to the author). Not a successful live inference. |
| Production admin workflow | reply, status, internal note | reply visible to the author after the admin sends it, internal note hidden, status updated |
| Live staging scripts (`tests/live/*`) | need demo passwords | **not run this session** |
| Mobile/responsive sweep (`ux-sweep.mjs`) | needs a deployed target | **not run this session** (earlier runs are recorded in `docs/qa/`) |

New in the registration release: successful registration, duplicate (all casings), invalid email, weak password variants, mismatched confirmation, missing fields, email normalisation, 8-way concurrent duplicate (exactly one winner), per-IP and global rate limits, `role=ADMIN` and other privilege fields rejected, admin routes denied to a new author, session creation and logout, existing admin and author login regression, new author starts empty and can create a ticket, cleanup planner/executor safety (token, blockers, exclusions, rollback, audit retention, file-key safety), production seed guard, admin tool.

Earlier regression tests: whitespace-padded login email (verified to fail with 400 before the fix), signed-in redirect from /login (author and admin), rule-based fallback labelling (labelled and unlabelled cases), zero-spend model guard (paid primary, paid fallback, router, free allowed, loopback exempt).

Port note: the E2E stack uses ports 3100/5180 by default; set `E2E_API_PORT`/`E2E_WEB_PORT` if they are taken.

## Final re-run (2026-10-16, Windows 11, Node 24.6)

typecheck clean; build clean; AI 509, API 292, web 68, infra 12, scaffold 9 passed; Playwright E2E 41/41 (system Chrome via `E2E_CHROMIUM_PATH`). Production checks: dataset parity 358 comparisons / 0 mismatches; 45/45 login, isolation and permission checks; 13/13 live ticket-flow checks; fresh encrypted backup restored in isolation. Real AI on the live site: **BLOCKED** (free daily quota 62/50 used); no inference was run in this pass. Details: `FINAL_ACCEPTANCE_REPORT.md`.
