# Architecture verification report

Scope: the documents in `docs/architecture/` (written by another process and left untracked, preserved here) checked against revision
`88cad7a` and the live staging system, 2026-10-16. "Checked" means a script or direct observation compared the document with the
source of truth; "read only" means I did not independently verify the content.

## 1. Checks performed

| Check | Method | Result |
| --- | --- | --- |
| ER diagram vs Prisma schema | script parsed `schema.prisma` and `diagrams/database-erd.mmd`: entities and scalar columns | 11/11 entities, 96 columns, no missing or extra |
| Enums | every value of the 6 enums searched in the docs | all present (UserRole 2, TicketStatus 4, TicketCategory 6, TicketPriority 4, MessageVisibility 2, AiAnalysisStatus 3) |
| Ticket lifecycle vs code | state diagram compared with `allowedTransitions` | 9/9 transitions match, no extra |
| API reference vs routes | `openapi.yaml` operations (method + path) vs `router.*` calls plus `/healthz` | 24/24 match, none extra |
| Frontend routes | routes in `AppRoutes.tsx` vs `06-FRONTEND-ARCHITECTURE.md` | all referenced |
| Triggers | the 6 live triggers vs the data dictionary | all documented |
| Mermaid syntax | every block rendered with Mermaid CLI 11 (Edge as browser) | initially 27/29; two failed (`;` inside sequence messages in `07` and `09`), fixed; now **35/35** render including the 6 new diagrams. Rendering validates syntax; the ERD, the system-architecture and the deployment diagrams were then also inspected visually (see section 2) |
| Links | 82 relative links across 31 Markdown files | 7 broken (missing documents 11, 12, 14, 15, 17) at the start; all now resolve once `docs/qa/*` exists |
| Deployment and topology claims | compared with `infra/` and the live VPS | corrected the retired shared-namespace mock design (see below) |
| Audit/data claims | live queries for audit payload keys, hash prefixes, triggers, constraints | corrected `AuditLog` (it stores `before`/`after` JSON of ids and enums, not "no payloads") and the `DELETE` coverage of the history triggers |

## 2. Corrections made (all local, uncommitted)

* `02-SYSTEM-ARCHITECTURE.md`: the demo mock is now drawn inside the API container as a supervised process enabled by `docker-compose.demo.yml`; container list, enablement and "read-only FS" text fixed; a garbled sentence about `AI_NOT_CONFIGURED` fixed.
* `09-AI-ARCHITECTURE.md`: safeguards row no longer claims a separate read-only container.
* `04-DATA-DICTIONARY.md`: `InternalNote` and `TicketAssignment` triggers cover `INSERT`/`UPDATE` only (BUG-003).
* `07-AUTHENTICATION-SECURITY.md`, `09-AI-ARCHITECTURE.md`: semicolons removed from two sequence-diagram messages.
* Added `11` (deployment), `12` (data flow), `14` (non-functional requirements), `15` (testing), `17` (known limitations) and `README.md` (index). Each states only what was observed; numbers 01, 13 and 16 remain unused.
* `docs/ENVIRONMENT.md`, `README.md`, `docs/KNOWN_LIMITATIONS.md` (tracked files): matching corrections.
* `02-SYSTEM-ARCHITECTURE.md`: after a visual review the system diagram was re-laid out (the third-party boundary overlapped the host and internal-network boxes and clipped their titles; declaring the third-party boundary and the database network earlier and shortening two titles fixed it). SVG/PNG renders of the system-architecture and deployment-architecture diagrams were added.
* Visual inspection: the full ERD (all 11 entities and all 17 foreign keys with the right delete rules, matching the live database), the system diagram and the deployment diagram were viewed as images. Other diagrams were validated by rendering and, where possible, by script, not by eye.
* `diagrams/*.mmd`: regenerated for all 35 diagrams with the project's own `export-diagrams.mjs` (extract only). The pre-existing SVG/PNG renders of the other diagrams were left as they were.

## 3. Not verified

* Prose in `05-BACKEND-ARCHITECTURE.md`, `06-FRONTEND-ARCHITECTURE.md`, `07-AUTHENTICATION-SECURITY.md`, `08-TICKET-LIFECYCLE.md`, `10-API-REFERENCE.md`, `03-DATABASE-ERD.md` and `09-AI-ARCHITECTURE.md` beyond the programmatic checks above (read for the stale-topology terms only).
* The remaining SVG/PNG images and the PlantUML use-case diagram were not re-rendered or visually reviewed.
* `openapi.yaml` was matched at operation level, not for schema detail.
* Statements about performance or scale (none are quantified in the documents).

## 4. Recommendation

Review and commit `docs/architecture/` together with the corrections, or keep it out of the submission until reviewed; as it stands
it is consistent with the code and the deployed topology for everything listed in section 1.
