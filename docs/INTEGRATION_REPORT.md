# Integration report (M2-M5)

Integration branch `integration/bookleaf-fullstack`: `main` (9366f16) + `agent/ai` (df0974a) + `agent/backend` (ca65343) + `agent/frontend` (8012348), merged with `--no-ff`, no conflicts, no overlapping files. Results were reproduced on the integrated tree against a disposable embedded PostgreSQL 18 and a local mock AI provider (no network, no paid calls). Windows 11, Node 24.6, npm 10.2.4.

## Integration fixes

1. Root `typecheck` script did not build `@bookleaf/ai` before typechecking the API (`Cannot find module '@bookleaf/ai'` on a clean tree). It now builds it first.
2. Attachment schemas existed twice (API and web) and were absent from `@bookleaf/contracts`. They now live there together with `ticketEventNameSchema` / `ticketEventPayloadSchema`; API and web import them.
3. `package-lock.json` regenerated with `npm install` for the merged workspaces (the specialists' uncommitted lockfile edits were not copied).
4. `docs/API_CONTRACT.md` and `README.md` described a scaffold; both now describe the implemented API.

## Verified behaviour (real HTTP + real browser)

Author: login, books, book detail (cross-author 404), ticket creation (foreign book rejected), attachment upload/list/download (byte-identical), reply persists after reload, other author gets 404 everywhere. Admin: queue, filters, field edits (persist after reload), assignment history, private notes (invisible to authors), AI analysis, "Insert draft" into the reply box (never auto-sent), reply delivered to the author, audit timeline, attachment download. Browser E2E ran in Chromium against `VITE_USE_MOCKS=false` (16/16 steps).

AI: single-flight under 3 concurrent requests (2 provider calls: classify + draft); provider 500 -> `AI_PROVIDER_ERROR`, 429 -> `AI_RATE_LIMITED`, hang -> `AI_TIMEOUT`, all `FAILED` with no draft and the ticket intact; manual retry after the 30 s cooldown recovers to `COMPLETED`; the grounding guard rejects off-topic output (`AI_UNGROUNDED_OUTPUT`); an injection attempt in the ticket text caused no action.

Security: CSRF, foreign Origin, forged/old/logged-out sessions, role separation, MIME/magic-byte/size/filename checks, no storage keys in responses, 429 on login brute force, DB triggers (AuditLog, InternalNote), no secrets or ticket text in logs, startup refuses placeholder secrets and non-https origin in production, Secure cookies behind `TRUST_PROXY`.

## Known issues and open decisions

- **Resolved (privacy hardening)**: royalty/price figures are no longer sent to the AI provider; see "Privacy behaviour" below.
- `npm audit --omit=dev`: 3 high advisories, all one chain (`prisma` -> `@prisma/config` -> `deepmerge-ts` < 8, GHSA-ggr8-5vv4-36mx). It sits in the Prisma CLI (a devDependency of `@bookleaf/db`, used for migrations), not request handling. The fix is a Prisma major upgrade; not applied.
- `npm run test:e2e` references Playwright but no config or specs exist; browser E2E was run ad hoc.
- Vite dev server has no `/api` proxy; set `VITE_API_BASE_URL` (CORS is configured for `WEB_ORIGIN`).
- Engine warnings: some dependencies want Node >= 24.15 / 22.22.2.
- Not verified: Linux/Docker PostgreSQL (Docker daemon was not running), a real reverse proxy, multi-instance deployment, real OpenRouter.

## Demo checklist (synthetic data only)

1. Fresh UTF8 database, `migrate deploy`, `seed:synthetic`.
2. Author: login -> book -> new ticket + attachment -> reply.
3. Admin: queue -> ticket -> overrides/assign -> private note -> Re-run AI -> Insert draft -> edit -> send.
4. Author: sees the reply, not the note.
5. Run `npm run typecheck`, `npm run build`, `npm test`.

## Privacy behaviour (AI provider)

Before: the draft call sent `mrp`, `totalCopiesSold`, `totalRoyaltyEarned`, `royaltyPaid`, `royaltyPending`, `lastRoyaltyPayoutDate` (and a masked ISBN); the classify call sent `royaltyPending` and `lastRoyaltyPayoutDate`. The backend handed the full serialized book to the AI package.

After: the backend allowlists `title, status, genre, publicationDate, printPartner, availableOn` before calling the engine (`apps/api/src/ai/context.ts`), and the AI package independently allowlists the same non-financial facts (`classifier/prompt.ts`, `drafting/prompt.ts`). The drafting prompt forbids stating or estimating any amount, balance, sales or payout date and tells the model to say the team will verify figures internally; a draft that invents an amount fails the grounding check and is replaced by the policy fallback. Admins still see exact figures in the portal.
