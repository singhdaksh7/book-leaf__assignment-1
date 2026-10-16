# BookLeaf Author Support and Communication Portal: submission package

Authors raise support tickets about their books; administrators triage them with an AI-assisted classification and draft, review and edit the draft, and explicitly send the reply. Nothing the AI produces is ever sent automatically.

| | |
| --- | --- |
| Live staging | https://bookleaf.77.37.45.177.sslip.io (release `83184cd`, real OpenRouter provider; when the free daily AI quota is exhausted, AI attempts show a rate-limit error and replies are written manually) |
| Repository | private GitHub repository `singhdaksh7/book-leaf__assignment-1`, branch `integration/bookleaf-fullstack` |
| Stack | React + Vite + TypeScript, Node 22 + Express, PostgreSQL 16 + Prisma, Zod contracts, OpenRouter AI, Docker Compose behind Traefik |
| Reviewer access | demo accounts are shared out of band; no passwords are stored in the repository |

## Run it locally

```bash
npm install
npm run build
npm test                       # AI, API (needs Postgres, see apps/api), web
npm run test:scaffold && npm run test:infra
cd apps/web && npx playwright test      # E2E on a disposable stack (set E2E_CHROMIUM_PATH to Chrome/Chromium if Playwright browsers are not installed)
```

Environment variables are documented in `docs/ENVIRONMENT.md`; templates are `infra/.env.example`, `apps/api/.env.example`, `packages/ai/.env.example`. Real AI needs `OPENROUTER_API_KEY` in `infra/.env` (git-ignored) and uses a free model by default; see `docs/release/AI_REAL_PROVIDER.md`.

## Where to read next

[REVIEWER_GUIDE.md](REVIEWER_GUIDE.md), [FEATURE_LIST.md](FEATURE_LIST.md), [TEST_RESULTS.md](TEST_RESULTS.md), [ARCHITECTURE_INDEX.md](ARCHITECTURE_INDEX.md), [DEMO_WALKTHROUGH.md](DEMO_WALKTHROUGH.md), [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md), and the Software Design Document `docs/SOFTWARE_DESIGN_DOCUMENT.md` (PDF alongside it when generated).
