# 12. Data Flow Diagrams

These diagrams show where data goes, not how code is organised (see [05 - Backend](05-BACKEND-ARCHITECTURE.md) and [09 - AI](09-AI-ARCHITECTURE.md) for that). They were derived from the routes in `apps/api/src/routes/*` and verified against live behaviour.

## 12.1 Author creates a ticket with an attachment

```mermaid
%% file: dataflow-ticket-creation.mmd
flowchart LR
    A["Author browser<br/>React SPA"] -->|"1. POST /api/v1/author/tickets<br/>JSON, cookie + X-CSRF-Token"| API["API"]
    API -->|"2. validate (Zod), rate limit 30/h,<br/>ownership of bookId"| API
    API -->|"3. one transaction: Ticket + PENDING AiAnalysis + AuditLog"| DB[("PostgreSQL")]
    API -->|"4. 201 {ticket}"| A
    A -->|"5. POST .../attachments?filename=...<br/>raw bytes, content-type allow-list"| API
    API -->|"6. size 5 MiB, 5 per ticket,<br/>magic-byte check, safe display name"| API
    API -->|"7. random 48-hex key, mode 0600"| FS[("attachments volume")]
    API -->|"8. metadata row: name, type, size, sha256, key"| DB
    API -.->|"9. after commit: SSE event<br/>{ticketId, occurredAt, version} only"| HUB["Event hub"]
    HUB -.-> A
    API -.->|"10. after commit: AI attempt<br/>minimised prompt, see 12.3"| AI["AI provider path"]
```

Notes. The file bytes never touch the database and the storage key is not derivable from the file name. An SSE event carries identifiers and a version, never message text. Steps 9 and 10 happen after the commit, so a failure there cannot lose the ticket.

## 12.2 Admin replies, writes an internal note, and the author sees only the reply

```mermaid
%% file: dataflow-admin-reply.mmd
flowchart LR
    AD["Admin browser"] -->|"POST /admin/tickets/:id/replies"| API["API"]
    AD -->|"POST /admin/tickets/:id/internal-notes"| API
    API -->|"TicketMessage (visibility AUTHOR)<br/>+ AuditLog"| DB[("PostgreSQL")]
    API -->|"InternalNote (admin only)<br/>+ AuditLog"| DB
    API -.->|"SSE: reply event to the ticket owner<br/>and to staff"| AU["Author browser"]
    AU -->|"GET /author/tickets/:id"| API
    DB -->|"messages + attachments only<br/>NEVER internal notes, AI analysis, audit log"| API
    API --> AU
```

Notes. Author endpoints build their responses from an allow-listed serializer; internal notes, AI analyses and audit events exist only on `/admin/*` endpoints. The live audit confirmed the author payload contained the reply text and no note text.

## 12.3 What leaves the system for AI (production path)

```mermaid
%% file: dataflow-ai-boundary.mmd
flowchart LR
    T["Ticket data in PostgreSQL"] --> F["Context builder<br/>apps/api/src/ai/context.ts<br/>allow-list"]
    F -->|"SENT: subject + description (digit runs masked),<br/>last two author-visible messages,<br/>public policy excerpts,<br/>non-financial book facts (title, status, genre,<br/>publication date, print partner, channels)"| P["@bookleaf/ai<br/>sanitise, ground, validate"]
    P -->|"HTTPS, bearer key"| OR["OpenRouter (third party)"]
    F -.->|"NEVER SENT: author name, e-mail, phone, city,<br/>ISBN, MRP, royalty or sales figures, payout dates,<br/>internal notes, passwords, session data"| X["blocked at the allow-list"]
    OR --> P
    P -->|"validated draft, stored as a FAILED or COMPLETED attempt"| T
```

Notes. The test `9b` in `apps/web/e2e/01-journey.spec.ts` inspects the exact bytes sent to a mock provider and asserts the absence of the author's e-mail, phone, city, name, ISBN, internal note and every financial field name. In the staging demo the same path points at the in-container mock on `127.0.0.1`, so nothing leaves the host; its output is canned and labelled `[DEMO MOCK]` / `[DEMO DRAFT]` and goes through the same validation.

## 12.4 Data classification

| Store | Contents | Sensitivity | Protection observed |
| --- | --- | --- | --- |
| `User` | e-mail, argon2id password hash, role | High | hash prefix `$argon2id$` on all 11 rows; never serialised |
| `Session` | SHA-256 hash of the session token, expiry | High | token itself only in an `HttpOnly; Secure; SameSite=Lax` cookie; row deleted on logout |
| `AuthorProfile`, `Book` | name, phone, city, ISBN, royalty and sales figures | High (financial and personal) | author-scoped queries; cross-author access returns 404; excluded from AI context |
| `Ticket`, `TicketMessage` | support conversation | Medium | author-scoped; admin sees all |
| `InternalNote` | staff-only text | Medium | admin endpoints only; UPDATE rejected by trigger |
| `AiAnalysis` | classification, rationale, draft, citations, token cost | Medium | admin endpoints only; author never receives it |
| `AuditLog` | actor, action, entity, request id, `before`/`after` JSON | Medium | append-only by trigger. The JSON holds only identifiers and enum values (observed keys: `messageId`, `noteId`, `attemptId`, `assigneeId`, `category`, `priority`, `status`, `visibility`), never message text; the API exposes neither column |
| attachments volume | uploaded files | Medium-High | random keys, mode 0600, ownership checked in the lookup, forced-download headers |
| `backups/` | database dump, attachment tarball | High | mode 700 directory on the same disk; encrypted since 2026-10-16, daily cron installed, no off-host copy |
