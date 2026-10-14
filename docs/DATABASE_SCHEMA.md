# Database schema

The executable Prisma baseline is `packages/db/prisma/schema.prisma`. It uses internal CUIDs as foreign keys while retaining immutable supplied identifiers as `externalAuthorId` and `externalBookId` with unique constraints.

This is a schema baseline only: no migration, database connection, seed implementation, or API serializer is supplied in Phase 1. After building, server consumers import `PrismaClient`, `Prisma`, enums, and model types from `@bookleaf/db`. Importing creates no client or global connection; the backend owns explicit instantiation and shutdown. Type-only imports are erased by TypeScript. Prisma model types are database types, not wire DTOs.

| Model | Purpose and key relationships |
| --- | --- |
| `User` | Login identity, role (`AUTHOR`/`ADMIN`), password hash. Has optional one-to-one `AuthorProfile`, sessions, authored messages/notes, assignments, audit events. |
| `AuthorProfile` | Supplied author identity/contact fields. Belongs to one user; has books and tickets. |
| `Book` | Exact supplied book data including nullable source values and `availableOn`. Belongs to one author; may be linked by tickets. |
| `Session` | Hashed opaque token, user, expiry and creation date. |
| `Ticket` | Author-owned support unit; optional book supports General/Account Level tickets; lifecycle/status/category/priority/assignee and timestamps. |
| `TicketMessage` | Conversation item. `AUTHOR` visibility is shared; author-facing replies must have this visibility. |
| `InternalNote` | Admin-only immutable note; always excluded from author queries. |
| `TicketAssignment` | Append-only assignment history, including assignment/unassignment actor data. Current assignee is denormalized on Ticket. |
| `AiAnalysis` | Each automated attempt: state, prompt version/model, structured result, citation IDs, usage/cost, or safe error code. |
| `AuditLog` | Append-only actor/action/entity/change/request correlation record. |

## Enums

Ticket status: `OPEN`, `IN_PROGRESS`, `RESOLVED`, `CLOSED`.

Exact required categories: `ROYALTY_PAYMENTS` (Royalty & Payments), `ISBN_METADATA` (ISBN & Metadata Issues), `PRINTING_QUALITY` (Printing & Quality), `DISTRIBUTION_AVAILABILITY` (Distribution & Availability), `BOOK_STATUS_PRODUCTION` (Book Status & Production Updates), and `GENERAL_INQUIRY` (General Inquiry).

Exact required priority values: `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`.

## Mapping the supplied JSON

Source author fields are exactly `author_id`, `name`, `email`, `phone`, `city`, `joined_date`, and `books`. Source book fields are exactly `book_id`, `title`, `isbn`, `genre`, `publication_date`, `status`, `mrp`, `author_royalty_per_copy`, `total_copies_sold`, `total_royalty_earned`, `royalty_paid`, `royalty_pending`, `last_royalty_payout_date`, `print_partner`, and `available_on`.

Dates map to `DateTime @db.Date`; money and royalty/copy counts map to integer rupee/copy values because supplied data is integer-valued. `available_on` maps to PostgreSQL `text[]`. The seed must not compute/overwrite royalties or coerce nulls. It may create deterministic author login identities separately from the source data, because credentials are not supplied.

The source documents remain unchanged in ignored `reference/`. The local seed copy is ignored at `data/bookleaf_sample_data.json`; publication requires owner verification of visibility and permissions. The backend seed handoff is in `data/README.md`; no seed command is available yet.

## Database-to-API serialization

AuthorProfile and Book scalar names match their resource schemas. `User.email` is returned by `currentUserSchema`, not duplicated into AuthorProfile. Database dates are `Date` objects: serialize timestamps with `toISOString()` and `@db.Date` fields as UTC `YYYY-MM-DD`. Preserve null on nullable scalar/link fields. Ticket summary omits description; full Ticket adds it. Never spread Prisma relations or private User/Session fields into responses.

Author detail includes only messages with `visibility=AUTHOR`, validated as `authorTicketMessageSchema`; admin detail can include both visibilities. Internal notes remain admin-only. Audit projections return only the fields in `auditEventSchema`, excluding raw before/after JSON. Database IDs have the meanings listed in `API_CONTRACT.md`.

## AI persistence and API mapping

`aiAnalysisSchema` describes a successful result, not an entire `AiAnalysis` row. The backend owns validation and mapping at both write and read boundaries; the Prisma schema alone cannot enforce these cross-field/JSON invariants.

| Persisted field | API mapping / invariant |
| --- | --- |
| `id`, `ticketId`, `createdAt`, `status` | Attempt envelope, with timestamp serialization |
| `category`, `priority`, `confidence`, `rationale`, `draftResponse` | Same-named fields inside `attempt.analysis` on COMPLETED; all required and validated through `aiAnalysisSchema` |
| `citations: Json?` | On COMPLETED, JSON array of string KB chunk IDs; map to `attempt.analysis.knowledgeBaseCitations`. Write `knowledgeBaseCitations` back into `citations`. Empty array is valid; null, objects, or non-string entries are not valid completed citations. |
| No persisted `requiresHumanReview` field | Inject literal `true` into each completed API result; reject false in AI output. This is a fixed review policy, never an approval flag or model decision. |
| `errorCode` | Null for PENDING/COMPLETED; nonempty sanitized code for FAILED |
| `model`, `promptVersion`, `inputTokens`, `outputTokens`, `costMicrounits` | Internal metadata only, not returned by the attempt DTO |

On PENDING and FAILED rows, result scalars and citations stay database NULL; the API represents them as `analysis: null`. Prisma writes of database NULL into `citations` use `Prisma.DbNull`, not JSON null. On COMPLETED rows, all result scalars and citations must be valid and non-null, with `errorCode` null. Store state/result together atomically; never expose a partial draft. A malformed legacy completed row must not become a valid-looking result: the backend records/reports a safe validation failure and withholds the draft. GET returns the latest attempt (creation time, then ID as a stable tie-break); no row maps to a null attempt.

The AI service returns only the validated completed payload. Backend implementation will create/update attempts, translate citations, supply the fixed review policy, and serialize through the HTTP schema. No automatic AI reply send or approval endpoint is introduced. Only an explicit admin reply action may create an author-visible message after review; retain the AI draft as analysis and audit the admin action.
