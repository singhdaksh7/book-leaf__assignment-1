# BookLeaf Author Support and Communication Portal: reviewer README

A support portal for BookLeaf Publishing. Authors raise tickets about their books and follow the conversation. Administrators work a queue and reply, helped by an AI assistant that classifies each ticket and drafts a policy-grounded reply. **A human always reviews, edits and explicitly sends the reply; the AI never sends anything.**

| | |
| --- | --- |
| Live site | https://bookleaf.77.37.45.177.sslip.io |
| Source | private GitHub repository `singhdaksh7/book-leaf__assignment-1`, branch `integration/bookleaf-fullstack` (access on request; see the cover email) |
| Live release | API `bookleaf-api:3eb1aff` (AI accuracy release, source commit `3eb1aff`), web `12edd72`, PostgreSQL 16 behind Traefik/HTTPS. The previous API image `12edd72` is kept as the one-command rollback. |
| Accounts | **Ten sample author accounts and one admin account are provided in the separate credentials handoff (not in this repository).** The ten authors are the assignment's original `AUTH001`-`AUTH010` with all 18 books (`BK001`-`BK018`), imported unchanged (358 field comparisons, 0 mismatches). New authors can also register themselves (they start empty). The admin cannot be created through the site. |

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

* Local automated tests all pass: AI package 509, API 292 (real PostgreSQL), web 68, 41 browser E2E (E2E last run on the previous commit; this release changed only the AI package). They use scripted or mock AI providers.
* **Real AI, local (real OpenRouter calls, free model, reported cost $0):** over the last three runs on the final code, classification and priority were correct for all six categories every time, and the model's draft passed the strict grounding checks for 5 of 6 tickets each time. The book-status draft was rejected each time because the model invented a timeline; the portal then shows a labelled policy-template draft instead. Details: `docs/release/AI_REAL_PROVIDER.md`.
* **Real AI, live site: NOT demonstrated.** On 2026-10-16 the key's free daily quota (50 requests) was already used up, so six live analyses all ended `FAILED` with `AI_RATE_LIMITED`. The portal handled it as designed (clear failure notice, no draft, nothing sent, manual reply works). No successful live inference is claimed. Once the quota resets the same code runs unchanged.
* Backups are encrypted, verified and restore-tested, with a daily cron; there is **no off-host copy**, so disaster recovery is incomplete.
