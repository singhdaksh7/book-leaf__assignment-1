# Testing

All tests use synthetic data and disposable services. Nothing calls a paid API: the AI provider is always a local mock.

## Commands

| Command | What it runs | Needs |
| --- | --- | --- |
| `npm run typecheck` | Builds shared packages, then typechecks db, ai, api (src + tests) and web | Node |
| `npm run typecheck:e2e --workspace @bookleaf/web` | Typechecks the Playwright code | Node |
| `npm run build` | Production build of all workspaces | Node |
| `npm test` | AI package, API (real PostgreSQL) and web (jsdom) suites | Node. The API suite starts a throwaway embedded PostgreSQL itself (or uses `TEST_DATABASE_URL`) and applies all 5 migrations |
| `BOOKLEAF_AI_ENTRY=<absolute path>/packages/ai/dist/index.js npm run test --workspace @bookleaf/api` | Also runs the 11 "real AI package, mocked provider" tests that `npm test` skips | `npm run build` first |
| `npm run test:infra` | Tests for the staging demo mock (`infra/mock-ai`): acknowledgement required, own-port loopback binding, all six categories, demo labels, citations, no invented money | Node |
| `npm run test:scaffold` | Contract / Prisma / importer alignment | `npm run build` first |
| `npm run test:e2e` | Browser end-to-end suite (Playwright) | see below |
| `npm audit --omit=dev` | Dependency advisories for production dependencies | network |

## Browser E2E (`npm run test:e2e`)

Prerequisites:

1. `npm install` and `npm run build` at the repository root (the E2E stack runs the built API, `@bookleaf/db` and `@bookleaf/ai`).
2. A Chromium for Playwright: `npx playwright install chromium`, **or** point at an installed Chrome/Chromium with `E2E_CHROMIUM_PATH` (PowerShell: `$env:E2E_CHROMIUM_PATH="C:\path\to\chrome.exe"`).

What happens (all in `apps/web/e2e/`, configured by `apps/web/playwright.config.ts`):

- Playwright's `webServer` runs `e2e/stack.mjs`, which starts a disposable embedded PostgreSQL on a random port, applies the migrations, imports the synthetic seed (`data/synthetic_seed.json`), starts a **mock OpenRouter** HTTP server, the built API on `127.0.0.1:3100` and a production web build served by `vite preview` on `127.0.0.1:5180` (override with `E2E_API_PORT` / `E2E_WEB_PORT`). Fake, throwaway credentials are generated in the script; nothing is read from your environment or `.env` files.
- Tests run in one worker, in file order (the files share one seeded database).
- `e2e/global-teardown.ts` asks the stack to stop gracefully, which stops PostgreSQL and deletes the temp directory. Reports: `apps/web/playwright-report/`, failure traces in `apps/web/test-results/` (both git-ignored).

| Spec | Covers |
| --- | --- |
| `01-journey.spec.ts` | 1 author login (wrong password first) - 2 book catalogue scoped to the author - 3 ticket creation with attachment - 4 attachment download byte-for-byte - 5 author reply persists after reload - 6 admin login, queue, assign, status - 7 internal-note privacy (UI and API) - 8 AI draft review with the mocked provider, never auto-sent - 9 admin reply visible to the author - 9b no identifying or financial data in the AI requests - 10 session expiry (UI and API) - 10b logout revokes the session, replayed cookie rejected |
| `02-boundaries.spec.ts` | Anonymous access, cookie flags, author vs admin separation (UI and API), cross-author ticket and attachment isolation, CSRF token and Origin checks, login CSRF, CORS, attachment content/type/size validation, forced-download headers, security headers |
| `03-production-proxy.spec.ts` | A second API with `NODE_ENV=production`, `TRUST_PROXY=1` and an https `WEB_ORIGIN` behind a local proxy: `Secure` + `HttpOnly` + `SameSite=Lax` cookies, HSTS, http origin rejected, startup refuses a placeholder secret or an http origin |

The mock AI answers a royalty classification and a policy-grounded draft; the privacy test inspects the exact requests it received. Non-royalty tickets created by the boundary tests get a `FAILED` / `AI_UNGROUNDED_OUTPUT` attempt because the mock's royalty draft does not fit them, which is the grounding guard working as designed.

Troubleshooting: if a port is in use set `E2E_API_PORT` / `E2E_WEB_PORT`; on Windows stop any running API before `npm run build` (it locks the Prisma engine DLL: `EPERM`); if a run was force-killed, stale `bookleaf-e2e-*` folders in the OS temp directory are cleaned automatically on the next run.

## Node versions

The suites pass on Node 24.6 (Windows) and Node 22 (Linux, Docker). `apps/web/src/test/setup.ts` makes `Response.blob()` return jsdom's `Blob`: on Node 22 (undici 6.x) the fetch `Response` returns Node's native `Blob`, which is not an `instanceof` jsdom's global `Blob`, so the two attachment-download tests failed there. Real browsers are unaffected, and the assertions are unchanged.

## Not covered by automation

Multi-instance deployments and the live OpenRouter API. The browser E2E suite has only been run on Windows; the staging deployment was checked by hand through its public HTTPS URL. See [Known limitations](KNOWN_LIMITATIONS.md).
