# Architecture

## Scope and requirements frozen in Phase 1

This document describes the target design. Phase 1 provides package wiring, request/response contracts, a Prisma schema, and an AI interface only. API and web entry points are placeholders. No authentication, routes, migrations, seeding, UI, SSE, retrieval, or AI provider execution is implemented.

BookLeaf Author Support & Communication Portal has separate author and internal-admin interfaces. Authors log in by email/password, see only their books and tickets, create book-specific or general-account tickets, and receive replies without a manual refresh. Admins operate a filterable queue and may classify, prioritise, assign, note, resolve, and reply. Optional attachment support is UI-only in the required scope.

The source assignment evaluates: AI integration (25%), architecture/code quality (25%), API design (15%), functionality/completeness (15%), product thinking (10%), and documentation/communication (10%). The core delivery priority is therefore the ticket flow and AI assistance before visual polish.

## Components

- `apps/web`: React, TypeScript, Vite, Tailwind author/admin SPA. It consumes only `@bookleaf/contracts` and the API.
- `apps/api`: Express REST API, authentication/RBAC boundary, SSE fan-out and polling-compatible resources.
- `packages/contracts`: Zod request/response schemas, enums, inferred types, and the canonical API error envelope. Compiled exports resolve from `dist/`.
- `packages/db`: Prisma schema and server-only exports of the generated client constructor, namespace, enums, and model types. Migrations and the seed importer are pending. Import creates no client or connection; the backend owns the client lifecycle.
- `packages/ai`: policy-grounded analysis interface; the OpenRouter adapter is pending. Compiled exports resolve from `dist/`.
- `data/bookleaf_sample_data.json`: ignored local copy of the confidential supplied data for future seeding; it must remain untracked pending visibility and publication-permission verification.
- `infra`: future Docker Compose and deployment files.

## Runtime flow

1. Browser authenticates to the API. The API sets a secure HTTP-only session cookie and stores only a token hash in PostgreSQL.
2. Author creates a ticket. It is durable before AI is attempted; a pending analysis job is recorded.
3. The AI worker/service retrieves only relevant policy chunks plus minimal author/book context, stores structured analysis, and publishes a ticket event.
4. Admin reviews or overrides all AI category/priority/draft outputs, then sends a visible reply or adds a private note.
5. API writes audit records and emits an SSE event. The web app reconnects and falls back to periodic ticket fetches when SSE is unavailable.

## Security boundaries

- Argon2id hashes passwords. Never return a password hash, session token, internal note, raw provider error, or API key.
- Cookie: `HttpOnly`, `Secure` in production, `SameSite=Lax`, explicit expiry; CSRF protection is required for mutating cookie-authenticated routes.
- Every database lookup for an author-scoped resource includes the authenticated `authorProfile.id`; route IDs alone never establish ownership.
- Only `ADMIN` may use `/admin/*`, internal-note, assignment, and AI-analysis routes. Internal notes are excluded at query and serializer levels for authors.
- Configuration is server-side environment configuration; `.env.example` documents names only.
- Original assignment documents remain untouched and ignored in `reference/`. Seed input is read locally from an ignored path; shared fixtures must be independently synthetic. Never log personal or royalty records.

## Dataset fidelity and edge cases

The seed importer must map every JSON field unchanged in meaning: `author_id`, author contact/location/joined date, and each book’s `book_id`, title, ISBN, genre, publication/status fields, royalty values, sales, payout date, print partner, and `available_on`. Do not turn supplied `null` values into zero/empty string: production books have null publication date/MRP/royalty-per-copy/print partner, and some books have a null payout date. Empty availability arrays and zero royalties are valid display states, not errors.

## Non-goals in this phase

No deployment, VPS access, remote branch/worktree creation, or full feature implementation occurs in Phase 1.

## Shared boundary rules

`docs/API_CONTRACT.md` names the schemas exported by `@bookleaf/contracts`. JSON dates are UTC ISO timestamps or `YYYY-MM-DD` for database date-only fields. List envelopes consistently use `items`, `page`, `pageSize`, and `total`; nullable database values remain explicit `null` on the wire.

`AiService` returns a completed `TicketAiAnalysis`; pending/failed database attempts use a separate HTTP attempt schema. `requiresHumanReview` is always `true`, not a persisted approval flag. Database `citations` stores the string IDs exposed as `knowledgeBaseCitations`. The exact mapping and state invariants are in `DATABASE_SCHEMA.md`; backend persistence/serialization is pending.
