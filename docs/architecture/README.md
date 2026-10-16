# Architecture documentation

Written against the code at `integration/bookleaf-fullstack`; `ARCHITECTURE_VERIFICATION_REPORT.md` records how each document was
checked against the source and what could not be checked. Diagrams are Mermaid blocks inside the documents (editable text). Running
`node docs/architecture/tools/export-diagrams.mjs` extracts each one into `diagrams/<name>.mmd`, and `--render` produces SVG/PNG
(needs `@mermaid-js/mermaid-cli` and a Chrome/Edge binary).

| # | Document | Contents |
| --- | --- | --- |
| 02 | [System architecture](02-SYSTEM-ARCHITECTURE.md) | Context, trust boundaries, components, production versus staging-demo AI |
| 03 | [Database ERD](03-DATABASE-ERD.md) | Full, simplified and per-area ER diagrams, migrations, constraints |
| 04 | [Data dictionary](04-DATA-DICTIONARY.md) | Every table and column, enums, triggers |
| 05 | [Backend architecture](05-BACKEND-ARCHITECTURE.md) | Middleware pipeline, routers, services, request lifecycle |
| 06 | [Frontend architecture](06-FRONTEND-ARCHITECTURE.md) | Routing, auth state, real-time client, file flow |
| 07 | [Authentication and security](07-AUTHENTICATION-SECURITY.md) | Sessions, CSRF, RBAC, sequence diagrams |
| 08 | [Ticket lifecycle](08-TICKET-LIFECYCLE.md) | State machine, creation and conversation sequences, attachments |
| 09 | [AI architecture](09-AI-ARCHITECTURE.md) | Workflow, human-in-the-loop, privacy boundary, production versus demo |
| 10 | [API reference](10-API-REFERENCE.md) | Endpoint inventory (`openapi.yaml` is the machine-readable form) |
| 11 | [Deployment architecture](11-DEPLOYMENT-ARCHITECTURE.md) | VPS topology, release flow, backup and rollback |
| 12 | [Data flow diagrams](12-DATA-FLOW-DIAGRAMS.md) | Ticket creation, admin reply, AI boundary, data classification |
| 13 | [DFD levels, UML, security, backup, AI provider](13-DFD-UML-SECURITY-BACKUP.md) | DFD 0/1/2, use case, domain classes, activity, component, security, backup, real vs demo AI |
| 14 | [Non-functional requirements](14-NON-FUNCTIONAL-REQUIREMENTS.md) | Properties implemented, evidence, what was not measured |
| 15 | [Testing architecture](15-TESTING-ARCHITECTURE.md) | Test layers, commands, results, pitfalls |
| 17 | [Known limitations](17-KNOWN-LIMITATIONS.md) | Limitations and unverified areas |
| - | [Verification report](ARCHITECTURE_VERIFICATION_REPORT.md) | How the documents were validated |

Numbers 01 and 16 are not used (no content exists for them); the existing numbering is kept so cross-references stay valid.
