# 13. Data Flow Levels, UML, Security, Backup and AI Provider Diagrams

Complements [12 Data flow diagrams](12-DATA-FLOW-DIAGRAMS.md) (concrete flows) with the formal DFD levels, the remaining UML views, and the security, backup and AI-provider architecture. Every element below was taken from the schema (`packages/db/prisma/schema.prisma`), the OpenAPI file and the source named in the neighbouring documents; the **backup** diagram describes scripts that exist in the repository but are **not installed on the VPS** (see §13.9).

## 13.1 DFD Level 0 (context)

```mermaid
%% file: dfd-level0.mmd
flowchart LR
    AU(["Author"])
    AD(["Administrator"])
    OR(["OpenRouter<br/>(external AI provider)"])
    P0(("0<br/>BookLeaf Author Support<br/>and Communication Portal"))
    AU -- "credentials, tickets, replies, attachments" --> P0
    P0 -- "own books, ticket history, admin replies, live updates" --> AU
    AD -- "credentials, status and priority changes, replies, internal notes, assignment, AI requests" --> P0
    P0 -- "queue, ticket workbench, AI analysis and draft, live updates" --> AD
    P0 -- "minimised ticket text and policy excerpts (HTTPS, API key in header)" --> OR
    OR -- "classification and draft as JSON (untrusted)" --> P0
```

## 13.2 DFD Level 1

```mermaid
%% file: dfd-level1.mmd
flowchart TB
    AU(["Author"])
    AD(["Administrator"])
    OR(["OpenRouter"])

    P1(("1<br/>Authenticate<br/>and authorise"))
    P2(("2<br/>Manage own<br/>tickets"))
    P3(("3<br/>Triage and<br/>reply"))
    P4(("4<br/>AI analysis"))
    P5(("5<br/>Attachments"))
    P6(("6<br/>Live events"))

    D1[("D1 User, AuthorProfile,<br/>Session")]
    D2[("D2 Book")]
    D3[("D3 Ticket,<br/>TicketMessage")]
    D4[("D4 InternalNote,<br/>TicketAssignment,<br/>AuditLog")]
    D5[("D5 AiAnalysis")]
    D6[("D6 Attachment files<br/>+ TicketAttachment")]

    AU -- "login" --> P1
    AD -- "login" --> P1
    P1 <--> D1
    AU -- "new ticket, reply" --> P2
    P2 <--> D3
    P2 -- "book lookup, ownership check" --> D2
    P2 -- "enqueue analysis" --> P4
    AD -- "status, priority, reply, note, assignment" --> P3
    P3 <--> D3
    P3 --> D4
    AD -- "request / re-run analysis" --> P4
    P4 -- "minimised input" --> OR
    OR -- "JSON output" --> P4
    P4 --> D5
    D5 -- "analysis and draft (admin only)" --> P3
    AU -- "upload, download" --> P5
    AD -- "download" --> P5
    P5 <--> D6
    P2 -- "events" --> P6
    P3 -- "events" --> P6
    P4 -- "events" --> P6
    P6 -- "SSE (own tickets only for authors)" --> AU
    P6 -- "SSE (all tickets)" --> AD
```

## 13.3 DFD Level 2: ticket workflow (process 2 and 3)

```mermaid
%% file: dfd-level2-ticket.mmd
flowchart TB
    AU(["Author"])
    AD(["Administrator"])
    V["2.1 Validate input<br/>(Zod, CSRF, Origin, rate limit)"]
    O["2.2 Check book ownership<br/>(SELECT ... FOR SHARE)"]
    C["2.3 Create ticket and first message<br/>(one transaction)"]
    A["2.4 Enqueue AI attempt<br/>(same transaction)"]
    R["2.5 Store author reply<br/>(rejected if CLOSED)"]
    Q["3.1 List and filter queue<br/>(paginated)"]
    S["3.2 Change status / category / priority<br/>(CLOSED is terminal)"]
    RP["3.3 Store admin reply<br/>(visibility AUTHOR)"]
    N["3.4 Store internal note<br/>(visibility ADMIN)"]
    AS["3.5 Assign to self"]
    D3[("Ticket,<br/>TicketMessage")]
    D2[("Book")]
    D4[("InternalNote,<br/>TicketAssignment,<br/>AuditLog")]
    EV["Event hub"]
    AU -- "subject, description, bookId" --> V --> O
    O -- "book row" --> D2
    O --> C --> D3
    C --> A
    AU -- "reply body" --> R --> D3
    AD --> Q
    Q -- "filters" --> D3
    AD -- "status, category" --> S --> D3
    AD -- "reply text" --> RP --> D3
    AD -- "note" --> N --> D4
    AD -- "self" --> AS --> D4
    S --> D4
    C --> EV
    R --> EV
    S --> EV
    RP --> EV
    N --> EV
    EV -- "own tickets" --> AU
    EV -- "all tickets" --> AD
```

## 13.4 DFD Level 2: AI workflow (process 4)

```mermaid
%% file: dfd-level2-ai.mmd
flowchart TB
    T[("Ticket, last 2<br/>author-visible messages,<br/>Book")]
    KB[("Built-in knowledge base<br/>(static policy chunks)")]
    OR(["OpenRouter<br/>free model"])
    ADM(["Administrator"])
    D5[("AiAnalysis")]
    EV["Event hub (admin audience)"]
    I1["4.1 Single-flight attempt<br/>(one PENDING row per ticket)"]
    I2["4.2 Build minimised input<br/>(no e-mail, phone, name, finances)"]
    I3["4.3 Sanitise and redact<br/>untrusted boundary, injection flags"]
    I4["4.4 Retrieve policy chunks"]
    I5["4.5 Classify (call 1)"]
    I6["4.6 Draft (call 2)"]
    I7["4.7 Validate output<br/>schema, citations, grounding"]
    I8["4.8 Decide result<br/>MODEL / PARTIAL fallback / FAILED"]
    T --> I1 --> I2 --> I3 --> I4
    KB --> I4
    I4 --> I5
    I5 -- "prompt" --> OR
    OR -- "JSON" --> I5
    I5 --> I6
    I6 -- "prompt" --> OR
    OR -- "JSON" --> I6
    I5 --> I7
    I6 --> I7 --> I8 --> D5
    I8 -. "provider errors surface as FAILED with errorCode;<br/>no mock substitution" .-> D5
    I8 --> EV
    D5 -- "analysis + draft" --> ADM
    ADM -- "edits, then explicitly sends a reply (separate request)" --> T
```

## 13.5 UML use case

```mermaid
%% file: usecase.mmd
flowchart LR
    AU(["Author"])
    AD(["Administrator"])
    AI(["OpenRouter<br/>(secondary actor)"])
    subgraph SYS["BookLeaf Author Support Portal"]
        UC1(["Sign in / out"])
        UC2(["View own books"])
        UC3(["Create ticket"])
        UC4(["Attach file"])
        UC5(["Reply to ticket"])
        UC6(["Follow ticket updates live"])
        UC7(["Browse and filter queue"])
        UC8(["Change status, category, priority"])
        UC9(["Reply to author"])
        UC10(["Write internal note"])
        UC11(["Assign ticket to self"])
        UC12(["Review AI analysis and draft"])
        UC13(["Run or re-run AI analysis"])
    end
    AU --- UC1 & UC2 & UC3 & UC5 & UC6
    UC3 -. "include (optional)" .-> UC4
    AD --- UC1 & UC7 & UC8 & UC9 & UC10 & UC11 & UC12 & UC13 & UC6
    UC13 -. "include" .-> AI
    UC12 -. "extend: admin edits the draft, then UC9" .-> UC9
```

## 13.6 UML domain class diagram

```mermaid
%% file: class-domain.mmd
classDiagram
    direction LR
    class User { id; email; passwordHash; role UserRole }
    class AuthorProfile { id; externalAuthorId; name; phone; city; joinedDate }
    class Session { id; tokenHash; expiresAt }
    class Book { id; title; status; royaltyPending; lastRoyaltyPayoutDate }
    class Ticket { id; subject; description; status; category; priority; createdAt }
    class TicketMessage { id; body; visibility MessageVisibility }
    class InternalNote { id; body }
    class TicketAssignment { id; assignedAt }
    class TicketAttachment { id; fileName; contentType; sizeBytes; storageKey }
    class AiAnalysis { id; status; model; promptVersion; category; priority; confidence; rationale; draftResponse; citations; errorCode }
    class AuditLog { id; action; metadata; createdAt }
    User "1" --> "0..1" AuthorProfile : has
    User "1" --> "*" Session : owns
    AuthorProfile "1" --> "*" Book : owns
    AuthorProfile "1" --> "*" Ticket : opens
    Book "1" --> "*" Ticket : about
    Ticket "1" *-- "*" TicketMessage : contains
    Ticket "1" *-- "*" InternalNote : admin-only
    Ticket "1" *-- "*" TicketAssignment : assigned
    Ticket "1" *-- "*" TicketAttachment : has
    Ticket "1" *-- "*" AiAnalysis : attempts
    Ticket "1" *-- "*" AuditLog : history
    User "1" --> "*" TicketAssignment : assignee (ADMIN)
```

Attribute lists are abbreviated; the authoritative column list, types, keys and indexes are in [04 Data dictionary](04-DATA-DICTIONARY.md) and [03 Database ERD](03-DATABASE-ERD.md).

## 13.7 UML activity: administrator handles a ticket with AI

```mermaid
%% file: activity-admin-ai.mmd
flowchart TB
    subgraph AUTHOR["Author"]
        A1(["Create ticket"])
    end
    subgraph SYSTEM["System"]
        S1["Persist ticket, enqueue AI attempt"]
        S2["Call OpenRouter (classify, draft)"]
        S3{"Output valid and grounded?"}
        S4["Store COMPLETED analysis (MODEL)"]
        S5["Store COMPLETED with visible<br/>rule-based fallback notice"]
        S6["Store FAILED with errorCode"]
        S7["Deliver reply to author, push event"]
    end
    subgraph ADMIN["Administrator"]
        D1["Open ticket"]
        D2{"Analysis available?"}
        D3["Read category, priority, rationale, draft"]
        D4["Edit or rewrite draft"]
        D5["Handle manually / re-run AI"]
        D6(["Press send (explicit action)"])
    end
    A1 --> S1 --> S2 --> S3
    S3 -- "yes" --> S4
    S3 -- "partly" --> S5
    S3 -- "no or provider error" --> S6
    S4 --> D1
    S5 --> D1
    S6 --> D1
    D1 --> D2
    D2 -- "COMPLETED" --> D3 --> D4 --> D6 --> S7
    D2 -- "FAILED / PENDING" --> D5
    D5 -- "re-run" --> S2
    D5 -- "manual reply" --> D6
```

## 13.8 UML component and AI provider architecture

```mermaid
%% file: component.mmd
flowchart TB
    subgraph BROWSER["Browser"]
        SPA["React SPA (Vite build)<br/>pages, API client, SSE client with polling fallback"]
    end
    subgraph WEBC["Container: web"]
        NG["nginx-unprivileged :8080<br/>static assets"]
    end
    subgraph APIC["Container: api (Node 22, Express)"]
        MW["Middleware: request id, headers, CORS/Origin,<br/>authenticate, CSRF, rate limits"]
        RT["Routers: auth, author, admin, events"]
        AT["Attachment store"]
        HUB["TicketEventHub (SSE)"]
        AAS["AiAttemptService"]
        AIP["@bookleaf/ai<br/>classifier, drafter, safety, grounding,<br/>OpenRouter client"]
        CON["@bookleaf/contracts (shared Zod schemas)"]
        DBP["@bookleaf/db (Prisma client)"]
    end
    PG[("PostgreSQL 16")]
    VOL[("attachments volume")]
    OR(["OpenRouter API"])
    SPA --> NG
    SPA -- "/api/v1, cookies, X-CSRF-Token" --> MW --> RT
    RT --> AT --> VOL
    RT --> HUB
    RT --> AAS --> AIP
    AIP -- "HTTPS" --> OR
    RT --> DBP --> PG
    AAS --> DBP
    RT -.-> CON
    SPA -.-> CON
    AIP -.-> CON
```

```mermaid
%% file: ai-provider-modes.mmd
flowchart LR
    subgraph API["api container"]
        SVC["@bookleaf/ai<br/>loadAiConfig()"]
        GUARD{"base URL is loopback?"}
        FREE{"model and fallback end with ':free'?"}
        DEFAULT["Default model:<br/>google/gemma-4-31b-it:free"]
    end
    KEY[/"OPENROUTER_API_KEY<br/>server-side env only (infra/.env, mode 600)"/]
    OR(["openrouter.ai/api/v1<br/>free endpoint, price 0"])
    subgraph DEMO["OPTIONAL: demo only"]
        MOCK["mock-ai on 127.0.0.1:8080<br/>canned [DEMO MOCK] text, no inference<br/>needs docker-compose.demo.yml<br/>and MOCK_AI_ACK=demonstration-only<br/>runs inside the api container"]
    end
    KEY --> SVC
    DEFAULT --> SVC
    SVC --> GUARD
    GUARD -- "no (real provider)" --> FREE
    FREE -- "yes" --> OR
    FREE -- "no: AI_NOT_CONFIGURED, no request sent" --> STOP(["Attempt FAILED"])
    GUARD -- "yes, only when demo override is applied" --> MOCK
```

## 13.9 Security architecture

```mermaid
%% file: security-architecture.mmd
flowchart TB
    NET(["Internet"]) --> FW["Host firewall: 22, 80, 443"]
    FW --> TLS["Traefik: TLS (Let's Encrypt), HSTS header"]
    TLS --> NGX["web: static files only"]
    TLS --> L1
    subgraph APIL["API defences, in request order"]
        L1["Request id + security headers (no framework banner, no-store on API data)"]
        L2["Origin check against WEB_ORIGIN (state-changing and login)"]
        L3["Session authentication: cookie token to SHA-256 lookup, fixed expiry"]
        L4["CSRF: X-CSRF-Token must equal HMAC(SESSION_SECRET, session id)"]
        L5["Rate limits: login (IP and account), ticket create, replies"]
        L6["Zod validation; unknown query keys rejected"]
        L7["Role guard: requireAuthor / requireRole(ADMIN)"]
        L8["Ownership scope: authorId taken only from the session; foreign ids answer 404"]
        L1 --> L2 --> L3 --> L4 --> L5 --> L6 --> L7 --> L8
    end
    L8 --> DBL["PostgreSQL on an internal-only network;<br/>triggers enforce book/author match and ADMIN-only assignees"]
    L8 --> FS["Uploads: size/type checks, stored outside web root,<br/>served as forced downloads, traversal names neutralised"]
    L8 --> AIB["AI boundary: provider output is untrusted,<br/>validated against shared schema, never sends anything"]
    SEC[/"Secrets: env only (SESSION_SECRET, POSTGRES_PASSWORD, OPENROUTER_API_KEY).<br/>API refuses placeholder secrets in production. Argon2id password hashes."/] -.-> APIL
```

## 13.10 Backup architecture

```mermaid
%% file: backup-architecture.mmd
flowchart TB
    subgraph HOST["VPS (compose project bookleaf)"]
        DB[("bookleaf-db")]
        VOL[("attachments volume (read-only mount)")]
        SCR["infra/scripts/backup.sh<br/>(manual today; cron example provided, NOT installed)"]
        PASS[/"BACKUP_PASSPHRASE_FILE (mode 600)"/]
        subgraph STORE["backups/ (mode 700)"]
            DAILY["daily/ keep 7"]
            WEEKLY["weekly/ keep 4 (Sundays)"]
            MONTHLY["monthly/ keep 3 (day 1)"]
            STATUS["last-status.json"]
        end
        RT["infra/scripts/restore-test.sh"]
        TMP["disposable postgres container<br/>internal network, tmpfs, removed after test"]
    end
    OFF[("Off-host store via rclone<br/>NOT CONFIGURED: no destination chosen")]
    HOOK(["Optional alert webhook (failure)"])
    DB -- "pg_dump (custom format) | openssl AES-256, PBKDF2" --> SCR
    VOL -- "tar czf | openssl AES-256" --> SCR
    PASS --> SCR
    SCR -- "verify: decrypt, pg_restore --list, tar t, SHA-256" --> DAILY
    DAILY --> WEEKLY
    DAILY --> MONTHLY
    SCR --> STATUS
    SCR -. "only if BACKUP_REMOTE set; encrypted files only" .-> OFF
    SCR -. "on failure" .-> HOOK
    DAILY --> RT --> TMP
```

Status of the backup chain: the scripts were exercised locally against disposable containers (backup, checksum, restore of 550 rows, wrong passphrase and tampered archive rejected, retention pruning). They have **not** been installed on the VPS, no off-host destination exists, and no restore has been performed from a production backup.
