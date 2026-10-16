# Environment configuration

Real environments inject variables directly. For local development copy `apps/api/.env.example` to `apps/api/.env` (loaded automatically by `npm run dev`) and `packages/db/.env.example` to `packages/db/.env` (used by migrate/seed). `.env` files are git-ignored; never commit real values. Error messages name variables, never values.

## API (`apps/api`)

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` enforces a non-placeholder `SESSION_SECRET`, an `https://` `WEB_ORIGIN` and `Secure` cookies. |
| `PORT` | `3000` | |
| `DATABASE_URL` | required | PostgreSQL 16+, **UTF8 database** (the API refuses to start otherwise): `CREATE DATABASE bookleaf ENCODING 'UTF8' TEMPLATE template0;` |
| `SESSION_SECRET` | required | At least 32 characters. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Used for CSRF token derivation. |
| `SESSION_TTL_HOURS` | `168` | 1-2160. |
| `SESSION_COOKIE_NAME` / `CSRF_COOKIE_NAME` | `bookleaf_session` / `XSRF-TOKEN` | The web app reads `XSRF-TOKEN` and echoes it as `X-CSRF-Token`. |
| `WEB_ORIGIN` | required | Exact browser origin (scheme + host + port, no path). Used for CORS and the Origin check on mutations and login. |
| `TRUST_PROXY` | `false` | `true` or a hop count (for example `1`) behind a reverse proxy, so `req.ip` (rate limits) and `Secure` cookies are correct. |
| `LOGIN_MAX_FAILURES` / `LOGIN_FAILURE_WINDOW_MINUTES` | `10` / `15` | In-memory per process. |
| `TICKET_CREATE_LIMIT_PER_HOUR` / `AUTHOR_REPLY_LIMIT_PER_HOUR` | `30` / `60` | In-memory per process. |
| `REGISTER_LIMIT_PER_IP_PER_HOUR` / `REGISTER_LIMIT_GLOBAL_PER_HOUR` | `5` / `200` | Public registration attempts (valid or not) per client IP and across all clients per hour. In memory per process. Needs `TRUST_PROXY` behind a proxy. |
| `ATTACHMENT_DIR` | `var/attachments` | Local disk, random keys, outside any served path. Back it up with the database. |
| `ATTACHMENT_MAX_BYTES` / `ATTACHMENT_MAX_PER_TICKET` | `5242880` / `5` | Max 25 MiB / 50. |

## Database tools (`packages/db`, run from the repository root or the API image's `/repo`)

| Variable | Used by | Notes |
| --- | --- | --- |
| `BOOKLEAF_ADMIN_EMAIL` / `BOOKLEAF_ADMIN_PASSWORD` | `npm run admin:ensure` | Required; password 12 to 128 characters with lowercase, uppercase and a digit. Read from the environment only. No defaults exist. |
| `BOOKLEAF_ALLOW_SYNTHETIC_SEED` | `seed`, `seed:synthetic` | Must equal `yes-i-understand` to seed synthetic accounts when `NODE_ENV=production`; otherwise refused. |
| `ATTACHMENT_DIR` | `npm run cleanup:synthetic` | Where attachment files live (`/data/attachments` in the API image); files of removed rows are deleted after the database commit. |

## AI (read by `@bookleaf/ai` through the API; see `packages/ai/README.md`)

AI is optional. With no key, tickets still work and analyses are recorded as `FAILED` / `AI_NOT_CONFIGURED`.

The same code runs in three clearly separate settings:

| Setting | Provider | What the output is |
| --- | --- | --- |
| **Production** | OpenRouter (`OPENROUTER_API_KEY` set; paid) | Real model inference, checked by the grounding/privacy validators; an admin reviews every draft |
| **Automated tests** | Local mock HTTP servers started by the test suites (API real-package tests, Playwright E2E) | Scripted responses; no network, no cost |
| **Opt-in staging demo** | `infra/mock-ai` ([Deployment](../infra/DEPLOY.md)) | Canned, keyword-matched text labelled `[DEMO MOCK]` (rationale) and `[DEMO DRAFT]` (draft); **not AI inference**. Never enable in production |

Production never falls back to fabricated output: without a key, or when the provider fails, the attempt is `FAILED` and admins work manually.

| Variable | Default | Notes |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | empty = AI disabled | Server-side only; wrapped in a redacting `Secret`, never logged or returned. |
| `OPENROUTER_MODEL` / `OPENROUTER_FALLBACK_MODEL` | `nvidia/nemotron-3-super-120b-a12b:free` / none (non-`:free` ids are rejected) | |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | `https://` required, except `http://localhost` / `127.0.0.1` (used by the tests' mock provider and by the staging demo mock, which runs as a supervised process inside the API container so it can be reached on loopback). |
| `AI_TIMEOUT_MS` / `AI_MAX_RETRIES` | `15000` / `2` | |
| `AI_RETRY_BASE_DELAY_MS` / `AI_RETRY_MAX_DELAY_MS` | `500` / `4000` | |
| `AI_MAX_OUTPUT_TOKENS` | `400` | |

## Database tooling (`packages/db`)

`DATABASE_URL` as above. Seed-only variables (never part of the dataset):

| Variable | Notes |
| --- | --- |
| `BOOKLEAF_SEED_AUTHOR_PASSWORD` | Required. Minimum 12 characters. Sets every author's password. |
| `BOOKLEAF_SEED_ADMIN_EMAIL` / `BOOKLEAF_SEED_ADMIN_PASSWORD` | Optional pair that creates an admin. |
| `BOOKLEAF_SEED_DATA_PATH` | Path to the (confidential) dataset for `npm run seed`. `npm run seed:synthetic` always uses `data/synthetic_seed.json`. |
| `BOOKLEAF_SEED_RESET_PASSWORDS` | `1` to deliberately overwrite existing passwords. |

## Web (`apps/web`)

| Variable | Notes |
| --- | --- |
| `VITE_API_BASE_URL` | API base, for example `http://localhost:3000/api/v1`. Baked into the bundle at build time; defaults to `/api/v1` (same-origin behind a proxy). |
| `VITE_USE_MOCKS` | `false` to use the real API in `vite dev`. Production builds **always** use the real API; the mock adapter, demo credentials and role switcher are compiled out. |

## Tests and E2E

| Variable | Notes |
| --- | --- |
| `TEST_DATABASE_URL` | Optional for `npm test`: use your own PostgreSQL (database name must contain `test`; tables are truncated). Default: a throwaway embedded PostgreSQL. |
| `BOOKLEAF_AI_ENTRY` | Absolute path to `packages/ai/dist/index.js` (a relative path is resolved from `apps/api` and silently skips the suite); also runs the 11 "real AI package, mocked provider" API tests (skipped otherwise). |
| `E2E_CHROMIUM_PATH` | Optional path to an installed Chrome/Chromium for Playwright, instead of `npx playwright install chromium`. |
| `E2E_API_PORT` / `E2E_WEB_PORT` | Default `3100` / `5180`. The E2E stack sets its own fake credentials and a mock AI provider; no real secret is needed or read. |
