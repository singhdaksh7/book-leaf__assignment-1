# Architecture index

All sources are Mermaid in `docs/architecture/diagrams/*.mmd` (46); rendered SVG/PNG exist in `svg/` and `png/` for 20 of them. Re-render with `node docs/architecture/tools/export-diagrams.mjs --render`.

| Topic | Document | Diagrams |
| --- | --- | --- |
| System, trust boundaries | architecture/02 | system-architecture, component |
| ERD, data dictionary | architecture/03, 04 | database-erd (full), database-erd-simplified, three per-area ERDs, class-domain |
| Backend / frontend | architecture/05, 06 | backend-architecture, backend-request-lifecycle, frontend-* |
| Authentication, security | architecture/07, 13 | auth-* sequences, security-architecture |
| Ticket lifecycle | architecture/08 | ticket-lifecycle (state), ticket-*-sequence |
| AI | architecture/09, 13, release/AI_REAL_PROVIDER | ai-workflow, ai-attempt-state, ai-*-sequence, ai-human-in-the-loop, ai-privacy-boundary, ai-provider-modes, activity-admin-ai |
| API | architecture/10, openapi.yaml | 25 operations |
| Deployment, backup | architecture/11, 13, operations/ | deployment-architecture, backup-architecture, release-flow |
| Data flow | architecture/12, 13 | dfd-level0, dfd-level1, dfd-level2-ticket, dfd-level2-ai, dataflow-* |
| UML | architecture/08, 13 | use-case.puml (source only), usecase.mmd, class-domain, activity-admin-ai, component, state diagrams |
| Testing | architecture/15 | testing-architecture |
