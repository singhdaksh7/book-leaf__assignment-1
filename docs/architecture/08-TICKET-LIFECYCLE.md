# 8. Ticket Management Architecture

## 8.1 Ticket attributes and who controls them

| Attribute | Values | Set by | Notes |
| --- | --- | --- | --- |
| `status` | `OPEN` (initial), `IN_PROGRESS`, `RESOLVED`, `CLOSED` | Admin (`PATCH /admin/tickets/:id`) | Transition table in §8.2 |
| `category` | `ROYALTY_PAYMENTS`, `ISBN_METADATA`, `PRINTING_QUALITY`, `DISTRIBUTION_AVAILABILITY`, `BOOK_STATUS_PRODUCTION`, `GENERAL_INQUIRY` | Admin only; initially `NULL` | The AI *suggests* a category in `AiAnalysis`; it is never copied to the ticket automatically |
| `priority` | `CRITICAL`, `HIGH`, `MEDIUM`, `LOW` | Admin only; initially `NULL` | Same: AI suggestion lives in `AiAnalysis` |
| `assigneeId` | an `ADMIN` user or `NULL` | Admin, **to self only** (`PUT …/assignment`) | Every change adds a `TicketAssignment` history row |
| `bookId` | one of the author's books or `NULL` | Author at creation | Cannot be changed afterwards (no route) |
| `subject`, `description` | 3–200 / 10–10 000 characters | Author at creation | Immutable afterwards |

Visibility: an author sees their own ticket fields (including `assigneeId`, an opaque id, a documented low-risk leak), the author-visible conversation and attachment metadata. Internal notes, AI analysis, assignment history and audit events are admin-only.

## 8.2 Ticket state diagram

```mermaid
%% file: ticket-lifecycle.mmd
stateDiagram-v2
    [*] --> OPEN : author creates ticket (POST /author/tickets)
    OPEN --> IN_PROGRESS : admin PATCH status
    OPEN --> RESOLVED : admin PATCH status
    OPEN --> CLOSED : admin PATCH status
    IN_PROGRESS --> OPEN : admin PATCH status
    IN_PROGRESS --> RESOLVED : admin PATCH status
    IN_PROGRESS --> CLOSED : admin PATCH status
    RESOLVED --> OPEN : admin reopens
    RESOLVED --> IN_PROGRESS : admin PATCH status
    RESOLVED --> CLOSED : admin PATCH status
    CLOSED --> [*] : terminal, every write returns 409

    note right of OPEN
        Author reply, admin reply, internal note,
        assignment, category and priority edits
        do not change status
    end note
    note right of CLOSED
        409 CONFLICT for: status, category and priority changes,
        author and admin replies, attachments,
        assignment changes, AI analysis.
        Internal notes are still accepted (no status check in the route).
    end note
```

The nine permitted edges are exactly those in `tickets/transitions.ts` (`OPEN`→{`IN_PROGRESS`,`RESOLVED`,`CLOSED`}, `IN_PROGRESS`→{`OPEN`,`RESOLVED`,`CLOSED`}, `RESOLVED`→{`OPEN`,`IN_PROGRESS`,`CLOSED`}). No code moves a ticket to `RESOLVED` or `CLOSED` automatically, and an author reply does **not** reopen a resolved ticket. A request that sets the same status again is a no-op (HTTP 200, no audit row). The release audit verified "reopen/reply/attachment on CLOSED all 409" on staging.

## 8.3 Ticket creation

```mermaid
%% file: ticket-creation-sequence.mmd
sequenceDiagram
    autonumber
    participant AU as Author browser
    participant API as POST /author/tickets
    participant DB as PostgreSQL
    participant AI as AiAttemptService
    participant HUB as TicketEventHub
    participant AD as Admin SSE streams

    AU->>API: {bookId or null, subject, description} + cookie + CSRF
    API->>API: requireAuthor, Zod validation (400 on failure)
    API->>API: creation limiter: 30 per hour per user, else 429
    API->>DB: BEGIN
    opt bookId is not null
        API->>DB: SELECT Book WHERE id AND authorId = me FOR SHARE
        DB-->>API: row or none (none: 404 "Book not found")
    end
    API->>DB: INSERT Ticket (status OPEN, category NULL, priority NULL, assignee NULL)
    API->>AI: enqueue(tx, ticketId)
    AI->>DB: INSERT AiAnalysis status PENDING (same transaction)
    API->>DB: COMMIT
    API->>HUB: publish ticket.created (audience all, version = updatedAt)
    HUB-->>AD: event delivered to admins and to the owning author
    API->>AI: kick(attemptId), runs in the background
    API-->>AU: 201 {ticket}
    Note over API,AI: The PENDING attempt commits with the ticket, so a crash cannot lose the analysis request. No AuditLog row is written for creation.
    Note over AU,API: The web client then uploads each selected attachment with separate requests.
```

If the AI engine is unavailable or unconfigured the ticket is still created and the attempt ends as `FAILED` (`AI_NOT_CONFIGURED`); ticket handling never depends on AI.

## 8.4 Author–admin communication

```mermaid
%% file: ticket-conversation-sequence.mmd
sequenceDiagram
    autonumber
    participant AU as Author browser
    participant API as API
    participant DB as PostgreSQL
    participant HUB as TicketEventHub
    participant AD as Admin browser

    Note over AD,API: Admin opens the ticket workbench
    AD->>API: GET /admin/tickets/:id
    API->>DB: ticket, author, book, ALL messages, internal notes, assignments, latest AI attempt, last 100 audit events
    API-->>AD: adminTicketDetail

    AD->>API: PUT /admin/tickets/:id/assignment {assigneeId: self}
    API->>DB: lock ticket, INSERT TicketAssignment, UPDATE Ticket.assigneeId, INSERT AuditLog
    API->>HUB: publish ticket.updated (all)

    AD->>API: POST /admin/tickets/:id/internal-notes {body}
    API->>DB: lock ticket, INSERT InternalNote, INSERT AuditLog
    API->>HUB: publish ticket.updated (audience admin only, nothing reaches the author)

    AD->>API: PATCH /admin/tickets/:id {status, category, priority}
    API->>DB: lock ticket, validate transition, UPDATE Ticket, one AuditLog row per changed field
    API->>HUB: publish ticket.updated (all)

    AD->>API: POST /admin/tickets/:id/replies {body}
    API->>DB: lock ticket (409 if CLOSED), duplicate check (same body within 60 s returns the original), INSERT TicketMessage visibility AUTHOR, bump updatedAt, INSERT AuditLog
    API->>HUB: publish ticket.reply.created (all)
    HUB-->>AU: SSE event {ticketId, occurredAt, version}
    AU->>API: GET /author/tickets/:id (refetch)
    API-->>AU: ticket and AUTHOR-visible messages only

    AU->>API: POST /author/tickets/:id/messages {body}
    API->>DB: lock ticket (own tickets only, 409 if CLOSED), duplicate check, INSERT TicketMessage AUTHOR, bump updatedAt, INSERT AuditLog ticket.author_reply.created
    API->>HUB: publish ticket.reply.created (all)
    Note over AD: Delivered to the admin's stream, but the current admin pages do not subscribe, so an admin sees the new message after reloading or acting on the page.
```

Rules worth stating:

* **A reply is a message only when a human sends it.** The AI draft is data on the admin screen; "Use AI draft" copies text into the admin's reply box (`handleUseAiDraft`), and only `POST …/replies` creates a `TicketMessage`.
* **Idempotent retry.** An identical body from the same sender on the same ticket within 60 seconds returns the original message (HTTP 201) instead of creating a second one.
* **Concurrency.** Writers lock the ticket row with `SELECT … FOR UPDATE`, so replies, status changes, assignment and AI requests on one ticket are serialised.
* **`updatedAt` is the change marker.** Replies explicitly bump it; it becomes the SSE event `version`, the catch-up cursor after reconnect and the polling comparison value. Internal notes are announced with a *new* timestamp but only to admins, so a note never looks like a ticket change to the author.
* **Resolution.** An admin sets `RESOLVED` (reopenable) or `CLOSED` (terminal). There is no automatic resolution, no author "close ticket" action and no e-mail notification (the UI text that mentions e-mail is aspirational; `KNOWN_LIMITATIONS.md`).

## 8.5 Attachment lifecycle

```mermaid
%% file: attachment-lifecycle.mmd
flowchart TB
    S["Author selects file on NewTicketPage"] --> C1{"Client checks<br/>non-empty, at most 5 MB,<br/>allowed type"}
    C1 -- "fail" --> X1["Inline error, nothing sent"]
    C1 -- "pass" --> U["POST /author/tickets/:id/attachments?filename=...<br/>raw bytes, Content-Type = file type"]
    U --> G1{"Session + CSRF OK?<br/>role AUTHOR?"}
    G1 -- "no" --> X2["401 / 403"]
    G1 -- "yes" --> G2{"Ticket exists and is owned by caller?"}
    G2 -- "no" --> X3["404 (same for foreign tickets)"]
    G2 -- "yes" --> G3{"Ticket status CLOSED?"}
    G3 -- "yes" --> X4["409 Closed tickets cannot receive attachments"]
    G3 -- "no" --> V{"Server validation<br/>type in allow-list, filename sanitised,<br/>non-empty, size within limit,<br/>magic bytes match declared type"}
    V -- "fail" --> X5["400 VALIDATION_ERROR"]
    V -- "pass" --> W["Write bytes to ATTACHMENT_DIR/storageKey<br/>48 hex chars, mode 0600, never overwrite"]
    W --> T["Transaction: lock ticket row,<br/>count attachments"]
    T --> L{"Already 5 attachments?"}
    L -- "yes" --> R["Rollback, delete the file, 409"]
    L -- "no" --> I["INSERT TicketAttachment<br/>metadata + sha256"]
    I --> OK["201 attachment metadata (no storage key)"]
    OK --> LIST["Listed: GET .../attachments (author own, admin any)"]
    LIST --> DL["Download: GET .../attachments/:id<br/>Content-Disposition attachment, nosniff,<br/>CSP default-src 'none'; sandbox"]
    DL --> END["Bytes kept on the volume for the life of the ticket"]
```

Lifecycle facts: only authors upload (there is no admin upload route); both roles can list and download; there is **no delete or replace route**, so files persist as long as the ticket row. If a ticket row were ever deleted by an operator the `Cascade` rule removes the metadata but not the file on disk (no cleanup job exists). Backups must include both the database and the attachments volume (`infra/scripts/backup.sh` does). Attachment content is **not** read by the AI in the current implementation (the AI input has no attachment field).

## 8.6 Audit events by action

| User action | Audit `action` | Written in the same transaction as |
| --- | --- | --- |
| Admin changes status / category / priority | `ticket.status.updated`, `ticket.category.updated`, `ticket.priority.updated` (one row per changed field) | the ticket update |
| Admin assigns / unassigns | `ticket.assignment.updated` | assignment row + ticket update |
| Admin replies | `ticket.reply.created` | the message |
| Author replies | `ticket.author_reply.created` | the message |
| Admin adds internal note | `ticket.internal_note.created` | the note |
| Admin requests AI analysis (new attempt created) | `ticket.ai_analysis.requested` | the new `PENDING` attempt |
| Ticket creation, attachment upload, login, logout, AI completion | *none* | – |
