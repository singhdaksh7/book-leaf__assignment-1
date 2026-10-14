# BookLeaf Author Support Portal

Phase 1 scaffold for an author support portal with an internal admin queue and AI-assisted ticket analysis. **This is not a working application.** Authentication, API routes, database migrations, seeding, UI screens, live updates, and the AI provider adapter are pending implementation by their assigned owners.

## Architecture and workspaces

An npm workspace monorepo uses TypeScript, React/Vite, Express, PostgreSQL/Prisma, and Zod. The planned API owns authentication, authorization, persistence, and ticket events. The AI service produces drafts for mandatory admin review; it cannot send replies.

| Workspace | Responsibility | Current status |
| --- | --- | --- |
| `apps/web` / `@bookleaf/web` | Author/admin browser UI | Empty entry point and Vite shell |
| `apps/api` / `@bookleaf/api` | REST API and SSE | Placeholder entry point; no listening server |
| `packages/contracts` / `@bookleaf/contracts` | Shared request/response schemas and inferred types | Scaffold contracts defined |
| `packages/db` / `@bookleaf/db` | Prisma schema and server-only exports | Schema and importable package; no migrations or seed |
| `packages/ai` / `@bookleaf/ai` | Provider-neutral `AiService` | Interface only; no OpenRouter adapter |
| `tests`, `infra` | Integration checks and future infrastructure | Scaffold tests only; infrastructure pending |

## Local setup

Use Node.js 22 LTS or newer and npm 10 (the package manager declaration specifies npm 10.9.2). Install and compile from the repository root:

```powershell
npm install
npm run typecheck
npm run build
npm run test:scaffold
npm ls --workspaces --depth=0
```

Build generates Prisma Client locally without connecting to PostgreSQL and emits server/package JavaScript and declarations into each workspace's ignored `dist/`. The browser typecheck never emits files. Package imports resolve after build; rerun the relevant package build after editing its source. Compilation and scaffold checks do not establish working application behavior.

For later backend work, copy `apps/api/.env.example` and `packages/db/.env.example` to the adjacent `.env` files and configure a local PostgreSQL URL. Copy `apps/web/.env.example` to `apps/web/.env` if overriding the Vite API URL. All real `.env` files are ignored. Environment loading in the API remains a backend task.

## Development commands

| Command | Meaning / limitation |
| --- | --- |
| `npm run dev` | Watches the API placeholder; does not serve endpoints yet |
| `npm run dev:web` | Serves the Vite shell; no portal screens yet |
| `npm run typecheck` | Builds shared declarations and checks all TypeScript workspaces |
| `npm run build` | Compiles packages/API and bundles the web shell |
| `npm run test:scaffold` | Checks wire contracts, Prisma alignment and imports after build |
| `npm run generate --workspace @bookleaf/db` | Generates Prisma Client locally |
| `npm run validate --workspace @bookleaf/db` | Validates Prisma schema; requires `DATABASE_URL`, no DB connection |
| `npm run migrate:dev --workspace @bookleaf/db` | Future local development migration command; requires PostgreSQL |
| `npm test`, `npm run test:api`, `npm run test:e2e` | Reserved implementation commands; no API/UI/E2E suites exist yet |
| `npm run lint` | Script aggregation only; no lint checks are configured yet |

There is deliberately no `seed` command until the backend owner supplies and verifies the importer. See [seed handoff](data/README.md).

## Package use

```ts
import { ticketDetailResponseSchema } from "@bookleaf/contracts";
import type { TicketDetailResponse } from "@bookleaf/contracts";
// Server only:
import { PrismaClient } from "@bookleaf/db";
import type { AiAnalysis } from "@bookleaf/db";
```

`@bookleaf/db` exports the generated Prisma constructor, namespace, enums, and model types. It creates no global client and makes no connection on import. The backend owner must explicitly instantiate a client and manage its connection/shutdown lifecycle. Do not import the DB package into the browser or AI engine.

## Confidential source data

The original assignment PDF and JSON stay unchanged under ignored `reference/`. The local copy `data/bookleaf_sample_data.json` contains confidential personal and royalty data and is also ignored. It must remain untracked until the owner verifies repository visibility and publication permissions; a private repository alone is not publication permission. No confidential sample records belong in commits, logs, tests, screenshots, or documentation. Use wholly synthetic fixtures for shareable demos and tests. `private: true` prevents npm publication, not Git disclosure.

## Design and ownership

- [Architecture](docs/ARCHITECTURE.md)
- [API response shapes and schema names](docs/API_CONTRACT.md)
- [Database and AI persistence mapping](docs/DATABASE_SCHEMA.md)
- [AI grounding and mandatory review policy](docs/AI_DESIGN.md)
- [Agent ownership and pending work](docs/AGENT_HANDOFF.md)
- [Verification and future acceptance criteria](docs/INTEGRATION_CHECKLIST.md)

The project owner controls all staging, commits, pushes, branches, worktrees, and deployment decisions. Phase 1 corrections stop at the scaffold; no deployment or VPS access is involved.
