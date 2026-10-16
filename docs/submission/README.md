# BookLeaf Author Support and Communication Portal: reviewer README

A support portal for BookLeaf Publishing. Authors raise tickets about their books and follow the conversation. Administrators work a queue and reply, helped by an AI assistant that classifies each ticket and drafts a policy-grounded reply. **A human always reviews, edits and explicitly sends the reply; the AI never sends anything.**

| | |
| --- | --- |
| Live site | https://bookleaf.77.37.45.177.sslip.io |
| Source | private GitHub repository `singhdaksh7/book-leaf__assignment-1`, branch `integration/bookleaf-fullstack` (access on request; see the cover email) |
| Live release | API and database `83184cd`, web `134f49b` (the registration release described below is prepared on the branch but **not yet deployed**; see `docs/release/REGISTRATION_RELEASE_PLAN.md`) |
| Accounts | Authors register themselves (*Create account* on the sign-in page; a new account starts empty). The single administrator is created by the owner on the server and cannot be created through the site; its login is sent separately and is not in the repository. Until the approved data cleanup runs, the live database still holds the older synthetic authors `synthetic.author1@example.test` … `synthetic.author10@example.test` |

## Stack

React + Vite + TypeScript (web) · Node.js 22 + Express + TypeScript (API) · PostgreSQL 16 + Prisma · Zod contracts shared by web, API and AI package · OpenRouter (free model `nvidia/nemotron-3-super-120b-a12b:free`) · Docker Compose behind a shared Traefik with Let's Encrypt TLS on a VPS · Vitest, Supertest, Testing Library, Playwright.

## Architecture in one paragraph

Three containers (web, api, db) sit behind Traefik. The browser loads static files from `web` and calls `/api/v1` on the same origin. The API owns authentication (server-side sessions, CSRF, Argon2id), authorisation (roles plus per-author scoping), the PostgreSQL database (11 tables), the attachment volume, a Server-Sent-Events hub with a polling fallback, and the AI integration. The AI package builds a minimised prompt (no e-mail, phone, name or financial data), calls OpenRouter twice (classify, then draft), treats the output as untrusted, and accepts it only if it passes schema, citation and strict grounding checks; otherwise the attempt is recorded as failed or as a clearly labelled rule-based fallback. Nothing is ever replaced by mock output.

## Features

Author: self-registration, sign in, dashboard, own books, create ticket, attachments, replies, live updates. Admin: filterable queue, status/category/priority changes, replies, internal notes, self-assignment, AI analysis and draft review, live updates. Security: HttpOnly session cookie, CSRF token, origin checks, rate limits, cross-author isolation (foreign ids answer 404), forced-download attachments. Operations: Docker Compose deployment, encrypted verified backups with a restore test and a daily cron, rollback images protected from the host prune job.

## Where to look

| What | Where |
| --- | --- |
| **Software Design Document (PDF, 30 pages)** | `docs/SOFTWARE_DESIGN_DOCUMENT.pdf` (Markdown source: `docs/SOFTWARE_DESIGN_DOCUMENT.md`) |
| Diagrams (47 editable Mermaid sources; SVG and PNG renders) | `docs/architecture/diagrams/` (`*.mmd`, `svg/`, `png/`); index in `docs/submission/ARCHITECTURE_INDEX.md` |
| ERD, data dictionary, DFD 0/1/2, UML, security, backup, AI modes | `docs/architecture/03`, `04`, `12`, `13` |
| API (25 operations) | `docs/architecture/10-API-REFERENCE.md`, `openapi.yaml` |
| AI design and real-provider evidence | `docs/architecture/09-AI-ARCHITECTURE.md`, `docs/release/AI_REAL_PROVIDER.md` |
| Deployment record, rollback, backups | `docs/release/DEPLOYMENT_RECORD.md`, `docs/operations/` |
| Demo instructions | `docs/submission/DEMO_WALKTHROUGH.md` |
| Test results | `docs/submission/TEST_RESULTS.md` |
| Known limitations | `docs/submission/KNOWN_LIMITATIONS.md` |
| Acceptance report | `docs/submission/FINAL_ACCEPTANCE_REPORT.md` |
| Registration release plan, cleanup inventory, admin account | `docs/release/REGISTRATION_RELEASE_PLAN.md`, `FINAL_CLEANUP_INVENTORY.md`, `ADMIN_ACCOUNT.md` |

## Run it locally

```bash
npm install && npm run build
npm test                                   # AI (485), API (292, needs Postgres), web (68)
npm run test:scaffold && npm run test:infra
cd apps/web && npx playwright test         # 41 browser E2E tests on a disposable stack (E2E_CHROMIUM_PATH for an installed Chrome)
```

Environment templates: `infra/.env.example`, `apps/api/.env.example`, `packages/ai/.env.example`. Real AI needs `OPENROUTER_API_KEY` in the git-ignored `infra/.env`.

## Honest status

* Local automated tests all pass; they use mock or scripted AI providers.
* Real-model behaviour was measured locally on the final code (classification 6/6 in every run; the strict grounding check accepted the model's draft in 12 of 13 analyses). The live-site real-AI smoke test depends on the OpenRouter free daily quota (50 requests, about 25 analyses a day); see `FINAL_ACCEPTANCE_REPORT.md` for the live result. When the quota is exhausted the portal shows a clear "AI analysis failed (AI_RATE_LIMITED)" notice and replies are written manually.
* Backups are encrypted, verified and restore-tested, with a daily cron; there is **no off-host copy**, so disaster recovery is incomplete.
