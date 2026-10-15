# API contract

Base path: `/api/v1`. All endpoints below are implemented in `apps/api` and verified against the real server (see `docs/INTEGRATION_REPORT.md`). Responses are JSON except the SSE stream and the empty logout response. Login is public and must have appropriate login-CSRF/origin protection; all other mutating requests require cookie authentication plus CSRF protection. Parse requests and serialize responses through the named schemas in `@bookleaf/contracts`.

## Error envelope

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "A human-readable explanation", "details": [], "requestId": "optional-correlation-id" } }
```

Use `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409 CONFLICT`, `429 RATE_LIMITED`, and `500 INTERNAL_ERROR`. Do not return provider/database internals. A failed AI request does not fail ticket creation.

## Endpoints

| Method | Path | Access | Contract |
| --- | --- | --- | --- |
| POST | `/auth/login` | Public | `loginRequestSchema` -> 200 `loginResponseSchema`; sets session cookie. |
| POST | `/auth/logout` | Authenticated | Revokes session; 204 with no body. |
| GET | `/auth/me` | Authenticated | 200 `meResponseSchema`. |
| GET | `/author/books` | Author | 200 `bookListResponseSchema`; caller's books, paginated. |
| GET | `/author/tickets` | Author | 200 `ticketListResponseSchema`; caller's tickets, paginated/filtered. |
| POST | `/author/tickets` | Author | `createTicketSchema` -> 201 `ticketResponseSchema`; null `bookId` means General / Account Level. |
| GET | `/author/tickets/:ticketId` | Author owner | 200 `ticketDetailResponseSchema`; shared messages only. |
| GET | `/author/books/:bookId` | Author owner | 200 `bookSchema` (bare object, not wrapped); 404 for another author's book. |
| POST | `/author/tickets/:ticketId/messages` | Author owner | `ticketReplySchema` -> 201 `ticketMessageResponseSchema`; visibility is always `AUTHOR` (a client-supplied visibility is ignored); 409 when the ticket is CLOSED; rate limited. |
| POST | `/author/tickets/:ticketId/attachments?filename=` | Author owner | Raw body with an allowed `Content-Type` (see `ATTACHMENT_*`) -> 201 `attachmentResponseSchema`. Type, size and magic bytes are validated; at most `ATTACHMENT_MAX_PER_TICKET` per ticket; 409 when CLOSED. |
| GET | `/author/tickets/:ticketId/attachments` | Author owner | 200 `attachmentListResponseSchema` (`{ items }`). No storage key is ever returned. |
| GET | `/author/tickets/:ticketId/attachments/:attachmentId` | Author owner | Bytes with `Content-Disposition: attachment`; 404 for others. |
| GET | `/admin/tickets/:ticketId/attachments` | Admin | 200 `attachmentListResponseSchema`. |
| GET | `/admin/tickets/:ticketId/attachments/:attachmentId` | Admin | Bytes (download). |
| GET | `/admin/tickets` | Admin | 200 `adminQueueResponseSchema`; same pagination/filter format; oldest urgent unresolved first. |
| GET | `/admin/tickets/:ticketId` | Admin | 200 `adminTicketDetailResponseSchema`. |
| PATCH | `/admin/tickets/:ticketId` | Admin | `updateTicketSchema` -> 200 `ticketResponseSchema`; AI values remain overrideable. |
| POST | `/admin/tickets/:ticketId/replies` | Admin | `ticketReplySchema` -> 201 `ticketMessageResponseSchema`. |
| POST | `/admin/tickets/:ticketId/internal-notes` | Admin | `internalNoteSchema` -> 201 `internalNoteResponseSchema`. |
| PUT | `/admin/tickets/:ticketId/assignment` | Admin | `assignTicketSchema` -> 200 `assignmentResponseSchema`. |
| POST | `/admin/tickets/:ticketId/ai-analysis` | Admin | 202 for pending or 200 for terminal state, `aiAnalysisRequestResponseSchema`. |
| GET | `/admin/tickets/:ticketId/ai-analysis` | Admin | 200 `aiAnalysisResponseSchema`; latest attempt or null if none. |
| GET | `/events/tickets` | Authenticated | `text/event-stream`; events are filtered to author ownership or admin role. |

SSE event names: `ticket.created`, `ticket.updated`, `ticket.reply.created`, `ticket.analysis.updated`. Payload (`ticketEventPayloadSchema`) is exactly `{ ticketId, occurredAt, version }`, all ISO strings; `version` is the ticket `updatedAt`. SSE `id:` is `<epoch-ms>-<n>`. Delivery is at-least-once: on reconnect with `Last-Event-ID` the server emits a `ticket.updated` for every in-scope ticket changed since that time, so clients dedupe on (`ticketId`, `version`). Clients reconnect with `Last-Event-ID`; if unavailable, poll ticket list/detail resources every 20-30 seconds.

## Implementation notes (verified)

- List responses use `{ items, page, pageSize, total }` (books, tickets, admin queue). Attachment lists use `{ items }`.
- Creating a ticket requires an explicit `bookId` (`null` = General / Account Level); omitting it is a 400.
- Admin ticket filters accept only `status`, `category`, `priority`, `from`, `to`, pagination; unknown keys (for example `authorId`, `q`) are rejected with 400.
- Priority values: `CRITICAL | HIGH | MEDIUM | LOW`. Status: `OPEN | IN_PROGRESS | RESOLVED | CLOSED`. A CLOSED ticket cannot be reopened (409) or replied to (409).
- `POST /admin/tickets/:id/ai-analysis` has a 30 s refresh cooldown after the latest attempt; within it the existing attempt is returned.
- Mutating requests need the session cookie, `X-CSRF-Token` (value of the `XSRF-TOKEN` cookie) and a matching `Origin`. A request with no `Origin` header is accepted unless `Sec-Fetch-Site: cross-site` (non-browser clients); the CSRF token is still required.
- There is no separate "AI review" endpoint: the draft is returned in `aiAnalysis.analysis.draftResponse`; an admin edits it and sends it through `/admin/tickets/:id/replies`. Nothing is ever sent automatically.

## Stable resource rules

IDs in API URLs are internal database IDs. Serialized book and author objects additionally expose the supplied external identifiers. A detail endpoint must respond `404` rather than reveal another author’s resource. Internal notes and admin-only AI rationale never enter author response DTOs.

## Canonical response shapes

Every named schema exports an inferred TypeScript type from the same package (for example `BookListResponse`, `AdminTicketDetailResponse`, `AiAnalysisAttempt`, and `ApiError`). The executable schemas in `packages/contracts/src/index.ts` are authoritative. Object parsers strip unknown fields; the backend must use the parsed output and explicitly filter relations. Parsing is not an ownership/authorization check.

All resource fields below are required unless explicitly described as optional. `?` below means nullable, not omitted. Arrays are always present, including when empty. Timestamps serialize as UTC ISO strings ending in `Z`; date-only database values serialize as `YYYY-MM-DD` without local timezone conversion.

| Resource / schema | Fields |
| --- | --- |
| `authorProfileSchema` | `id`, `userId`, `externalAuthorId`, `name`, `phone`, `city`, `joinedDate` (date only) |
| `currentUserSchema` | `id`, `email`, `role`, `authorProfile?`; never hashes or sessions |
| `authResponseSchema` (login/me aliases) | `{ user: CurrentUser }` |
| `bookSchema` | `id`, `externalBookId`, `authorId`, `title`, `isbn`, `genre`, `publicationDate?`, `status`, `mrp?`, `authorRoyaltyPerCopy?`, `totalCopiesSold`, `totalRoyaltyEarned`, `royaltyPaid`, `royaltyPending`, `lastRoyaltyPayoutDate?`, `printPartner?`, `availableOn: string[]` |
| `ticketSummarySchema` | `id`, `authorId`, `bookId?`, `subject`, `status`, `category?`, `priority?`, `assigneeId?`, `createdAt`, `updatedAt` |
| `ticketSchema` | All ticket summary fields plus `description` |
| `ticketResponseSchema` | `{ ticket: Ticket }` |
| `ticketMessageSchema` | `id`, `ticketId`, `authorId` (User ID), `body`, `visibility` (`AUTHOR` or `ADMIN`), `createdAt` |
| `authorTicketMessageSchema` | Same message fields, with `visibility` restricted to `AUTHOR` |
| `ticketMessageResponseSchema` | `{ message: AuthorTicketMessage }` |
| `ticketDetailResponseSchema` | `{ ticket: Ticket, messages: AuthorTicketMessage[] }` |
| `internalNoteResourceSchema` | `id`, `ticketId`, `authorId` (User ID), `body`, `createdAt` |
| `internalNoteResponseSchema` | `{ note: InternalNote }` |
| `ticketAssignmentSchema` | `id`, `ticketId`, `assigneeId?`, `assignedById`, `createdAt` |
| `assignmentResponseSchema` | `{ ticket: Ticket, assignment: TicketAssignment }` |
| `auditEventSchema` | `id`, `actorId?`, `action`, `entityType`, `entityId`, `requestId?`, `createdAt`; no raw `before`/`after` JSON |
| `adminTicketDetailResponseSchema` | `{ ticket: Ticket, author: AuthorProfile, book: Book or null, messages: TicketMessage[], internalNotes: InternalNote[], assignments: TicketAssignment[], aiAnalysis: AiAnalysisAttempt or null, auditEvents: AuditEvent[] }` |

`AuthorProfile` excludes email because it is stored on `User`; the authenticated user carries email separately. `Ticket.authorId` and `Book.authorId` are AuthorProfile IDs, while message/note authors and assignment actors are User IDs. Missing book links or deleted assignees serialize as null. All money/count fields are integers; book status remains a source string, not a new enum. Nullable monetary/date/partner fields retain null, and zero and empty availability arrays remain valid.

## Pagination and filters

Books, author ticket lists, and the admin queue all return `{ items, page, pageSize, total }`, using `paginationSchema`. Page numbering starts at 1; default `page=1`, `pageSize=25`, maximum `pageSize=100`. `total` is the count after applying access restrictions and filters, before pagination. Empty/out-of-range pages return `items: []` and the actual total.

`bookListResponseSchema.items` contains books. Both `ticketListResponseSchema.items` and `adminQueueResponseSchema.items` contain ticket summaries. Book requests accept only pagination. Ticket queries use `ticketFilterSchema`: optional `status`, `category`, `priority`, `from`, `to`, plus pagination. The backend will validate date query strings and `from <= to`; dates bound ticket creation time inclusively. No response field uses query-style coercion.

## AI result versus attempt

`aiAnalysisSchema` / `TicketAiAnalysis` is a completed result: `{ category, priority, confidence, rationale, draftResponse, requiresHumanReview: true, knowledgeBaseCitations: string[] }`. Confidence is between 0 and 1. Citation IDs refer to retrieved KB chunks. Admin review is required for every draft, even when confidence is high.

`aiAnalysisAttemptSchema` adds attempt identity and state:

| Status | Required fields (in addition to `id`, `ticketId`, `createdAt`) |
| --- | --- |
| `PENDING` | `analysis: null`, `errorCode: null` |
| `COMPLETED` | `analysis: TicketAiAnalysis`, `errorCode: null` |
| `FAILED` | `analysis: null`, `errorCode: string` (nonempty sanitized code) |

GET wraps the latest attempt as `{ analysis: AiAnalysisAttempt or null }`; POST wraps a non-null attempt. Admin detail uses `aiAnalysis` for that same latest attempt. No attempts means null; an attempt with no result is a non-null pending/failed object. Internal provider metadata, prompts, token usage and cost remain server-side. See `DATABASE_SCHEMA.md` for the exact persisted-field mapping.

All failures use `apiErrorSchema` / `ApiError`: `{ error: { code: string, message: string, details?: unknown, requestId?: string } }`. Optional `details` must be sanitized validation information, never raw exceptions or confidential records. The status/code pairs listed above are the standard errors; provider failures use safe attempt codes instead of failing ticket creation.
