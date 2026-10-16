# Submission checklist

Status as of final QA on `integration/bookleaf-fullstack` (Windows 11, Node 24.6). `[x]` = verified by an automated run in this QA pass; `[ ]` = open or needs the owner.

## Code and tests
- [x] `npm run typecheck` (all workspaces) and `npm run typecheck:e2e --workspace @bookleaf/web`
- [x] `npm run build`
- [x] `npm test`: AI package, API (216 passed, 11 skipped without `BOOKLEAF_AI_ENTRY`) and web suites
- [x] API real-AI-package tests (12/12 with an absolute `BOOKLEAF_AI_ENTRY`)
- [x] `npm run test:scaffold` (9/9)
- [x] All 5 migrations apply to an empty UTF8 PostgreSQL (API test setup and the E2E stack both do this)
- [x] `npm run test:e2e`: 30/30 in Chromium (journey, boundaries, production-proxy)
- [x] Linux/Docker: web (46/46), AI (456/456), API incl. real AI package (227/227) and scaffold (9/9) on Node 22
- [x] Staging deployment verified through its public HTTPS URL (see [Deployment](../infra/DEPLOY.md))

## Security and privacy
- [x] AI requests carry no author identity, ISBN, internal notes or financial data (E2E 9b + API privacy tests)
- [x] No secrets, ticket text or financial values in API logs (scan of a full E2E run)
- [x] CSRF, Origin, authorization, session expiry/logout, attachment validation verified end to end
- [x] Production bundle contains no demo credentials
- [ ] Decide on the 3 Prisma-chain advisories (accept, or apply the `deepmerge-ts` override and re-test): [Security review](SECURITY_REVIEW.md)
- [ ] Decide whether to hide `assigneeId` from author payloads (low)

## Repository hygiene
- [x] `main` unchanged (still `9366f16`); specialist worktrees untouched; nothing pushed or merged (a staging stack is deployed from this branch)
- [x] Confidential `data/bookleaf_sample_data.json` and `reference/` not read, copied or committed (git-ignored)
- [x] Only synthetic data in tests, demos and docs
- [ ] Review and commit the QA changes (they are uncommitted in the working tree)
- [x] `infra/` and `.dockerignore` reviewed, built, run locally and deployed (see [Deployment](../infra/DEPLOY.md))
- [ ] Confirm the final `.env` for any deployment (`SESSION_SECRET` >= 32 random chars, https `WEB_ORIGIN`, `TRUST_PROXY`, `OPENROUTER_API_KEY` if AI is wanted)

## Documentation
- [x] [README](../README.md) setup, commands, limitations
- [x] [Architecture](ARCHITECTURE.md), [API contract](API_CONTRACT.md), [Database schema](DATABASE_SCHEMA.md), [AI design](AI_DESIGN.md)
- [x] [Environment guide](ENVIRONMENT.md), [Testing](TESTING.md), [Demo](DEMO.md), [Security review](SECURITY_REVIEW.md), [Known limitations](KNOWN_LIMITATIONS.md)

## Demo day
- [ ] Fresh database, `migrate:deploy`, `seed:synthetic`, then follow [Demo](DEMO.md)
- [ ] Decide whether to demo with a real `OPENROUTER_API_KEY` (paid) or without AI
