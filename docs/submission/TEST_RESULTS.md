# Test results

Run on this branch for the registration release (2026-10-16), Windows 11, Node 24.6, Chrome for E2E. All use synthetic data; **all AI tests use a mock or scripted provider.**

| Suite | Command | Result |
| --- | --- | --- |
| AI package | `cd packages/ai && npx vitest run` | 485 passed |
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
| Live staging scripts (`tests/live/*`) | need demo passwords | **not run this session** |
| Mobile/responsive sweep (`ux-sweep.mjs`) | needs a deployed target | **not run this session** (earlier runs are recorded in `docs/qa/`) |

New in the registration release: successful registration, duplicate (all casings), invalid email, weak password variants, mismatched confirmation, missing fields, email normalisation, 8-way concurrent duplicate (exactly one winner), per-IP and global rate limits, `role=ADMIN` and other privilege fields rejected, admin routes denied to a new author, session creation and logout, existing admin and author login regression, new author starts empty and can create a ticket, cleanup planner/executor safety (token, blockers, exclusions, rollback, audit retention, file-key safety), production seed guard, admin tool.

Earlier regression tests: whitespace-padded login email (verified to fail with 400 before the fix), signed-in redirect from /login (author and admin), rule-based fallback labelling (labelled and unlabelled cases), zero-spend model guard (paid primary, paid fallback, router, free allowed, loopback exempt).

Port note: the E2E stack uses ports 3100/5180 by default; set `E2E_API_PORT`/`E2E_WEB_PORT` if they are taken.
