# Agent handoff and file ownership

Do not edit another owner’s files without coordinating first. Shared boundaries are reviewed by Codex integration only.

| Owner | May create/edit | Must not edit |
| --- | --- | --- |
| Claude Code - backend/database | `apps/api/**`, `packages/db/**`, synthetic fixtures in `data/**`; local seed input read-only | `apps/web/**`, `packages/ai/**`, original reference files, docs contracts without approval |
| Antigravity - frontend/UI | `apps/web/**`, frontend tests | API/Prisma/AI package and contract schemas |
| Fourth agent - AI engine | `packages/ai/**`, AI-specific unit tests | API routes, web, Prisma schema, contract enums |
| Codex - integration/review/testing/deployment prep | root config, `packages/contracts/**`, `docs/**`, `infra/**`, cross-cutting tests | Feature work inside another agent’s owned subtree unless resolving integration conflict |

## Integration contracts

- Claude consumes contracts and invokes `AiService`; it owns queueing/retry wiring and authorization middleware.
- Fourth agent implements the `AiService` interface and uses no Express/Prisma imports.
- Antigravity calls only documented HTTP endpoints and never embeds policy rules/API keys.
- Changes to shared contracts/schema require a proposal in the PR/hand-off and an integration pass before dependent work is merged.

- Response shapes and exported schema/type names are specified in `API_CONTRACT.md`. Parse responses before serialization; preserve explicit nulls, date formats, and the common pagination envelope. Author responses never include internal notes or AI details.
- Server consumers import the generated Prisma constructor/enums/types through `@bookleaf/db` after build. No global client is exported. Claude owns client instantiation, connection lifecycle, migrations, and API serialization.
- AI results have literal `requiresHumanReview: true`; this is API policy, not persisted approval state. Claude owns state-aware mapping of `AiAnalysis.citations` to `knowledgeBaseCitations` as specified in `DATABASE_SCHEMA.md`. The AI agent returns validated completed output and does not access the database. Only an explicit admin reply action sends a reviewed draft.

## Phase 1 correction scope

The owner authorized Codex to fix shared integration defects in package manifests, TypeScript build configuration, the DB entry point and schema comments. Those changes do not transfer feature ownership. API/UI placeholder entry points and the AI interface remain implementation boundaries; no feature code, database connection, migration, or provider call is added in this correction.

Backend pending work includes authentication/RBAC, routes and serializers, migrations, local seed importer, AI attempt lifecycle, audit writes, SSE/polling resources, and integration tests. Frontend pending work includes all UI flows and review interactions. AI pending work includes retrieval, provider integration, grounding validation, and safe failure handling.

## Seed handoff and confidentiality

No `seed` script is advertised until `packages/db/prisma/seed.ts` exists and is verified. Claude must implement the plan in `data/README.md`: read an explicit local `BOOKLEAF_SEED_DATA_PATH` or the ignored repository-relative default, validate before writing, preserve source values/nulls, upsert transactionally, configure credentials separately, and disconnect Prisma. Tests must use synthetic fixtures and logs must not contain sample records.

`reference/` remains ignored and unchanged. `data/bookleaf_sample_data.json` also remains ignored until the owner verifies repository visibility and publication permissions. No agent may publish original reference documents. Public demo data must be created separately and be entirely synthetic.

## Repository control

The project owner handles staging, commits, pushes, branches, worktrees, and any later deployment decisions. This correction does none of those actions, does not access the VPS, and stops at the scaffold. Subsequent owners must not treat a placeholder build as functional acceptance.
