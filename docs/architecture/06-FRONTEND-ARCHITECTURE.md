# 6. Frontend Architecture

Single-page application in `apps/web`: React 18.3, TypeScript, Vite 6, React Router 7 (`react-router-dom ^7.18.4`), Tailwind CSS 3.4, `lucide-react` icons, Zod via `@bookleaf/contracts`. There is **no** Redux/Zustand/React Query: state is local `useState` plus one React context. Unit tests use Vitest + jsdom; end-to-end tests use Playwright (Chromium).

## 6.1 Source layout

```text
apps/web/src/
├── main.tsx                  ReactDOM root (StrictMode)
├── App.tsx                   BrowserRouter > AuthProvider > AppRoutes
├── router/
│   ├── AppRoutes.tsx         route table
│   └── ProtectedRoute.tsx    auth + optional role gate
├── context/AuthContext.tsx   user, isLoading, login, logout, refreshUser, client
├── api/
│   ├── client.ts             ApiClient interface, ApiClientError, DownloadResult
│   ├── http.ts               HttpApiClient (fetch, CSRF header, Zod response validation, 401 notification)
│   ├── mock.ts               MockApiClient (in-memory fixtures; development only)
│   ├── index.ts              chooses the client (mock never used in production builds)
│   ├── events.ts             TicketEventManager: EventSource + polling fallback + de-duplication
│   └── attachments.ts        client-side type/size checks, filename sanitiser, Content-Disposition parser
├── components/
│   ├── layout/               AppLayout (sidebar + navbar + <Outlet/>), Sidebar, Navbar
│   └── common/               Alert, Badge, Button, Card, EmptyState, Input, Select, Skeleton, StatCard
├── pages/
│   ├── auth/LoginPage.tsx
│   ├── author/               DashboardPage, BooksPage, BookDetailPage, TicketsPage, NewTicketPage, TicketDetailPage
│   ├── admin/                AdminDashboardPage, AdminQueuePage, AdminTicketDetailPage
│   └── NotFoundPage.tsx
└── test/                     Vitest suites (admin, api-client, attachments, auth, author-replies-sse, books, tickets)
```

There are no custom hooks files: the only hook is `useAuth()` exported from `AuthContext.tsx`. Shared utilities live in `api/attachments.ts` and `api/events.ts`.

## 6.2 Component architecture

```mermaid
%% file: frontend-architecture.mmd
flowchart TB
    MAIN["main.tsx<br/>ReactDOM.createRoot, StrictMode"] --> APP["App<br/>BrowserRouter"]
    APP --> AP["AuthProvider (context)<br/>user, isLoading, login, logout, refreshUser"]
    AP --> ROUTES["AppRoutes<br/>React Router route table"]

    ROUTES --> LOGIN["LoginPage<br/>public /login"]
    ROUTES --> PR1["ProtectedRoute<br/>any signed-in user"]
    PR1 --> LAYOUT["AppLayout<br/>Sidebar + Navbar + Outlet"]

    subgraph AUTHOR["Author pages (requireAuthor on the API)"]
        DASH["DashboardPage"]
        BOOKS["BooksPage"]
        BOOK["BookDetailPage"]
        TICKS["TicketsPage"]
        NEWT["NewTicketPage"]
        TDET["TicketDetailPage"]
    end

    subgraph ADMINP["Admin pages (ProtectedRoute requiredRole=ADMIN)"]
        ADASH["AdminDashboardPage"]
        AQ["AdminQueuePage"]
        ADET["AdminTicketDetailPage"]
    end

    LAYOUT --> AUTHOR
    LAYOUT --> ADMINP
    ROUTES --> NF["NotFoundPage<br/>path *"]

    COMMON["components/common<br/>Alert, Badge, Button, Card, Input, Select, Skeleton, StatCard, EmptyState"]
    AUTHOR --> COMMON
    ADMINP --> COMMON

    AP -- "client" --> CLIENT["ApiClient interface"]
    CLIENT --> HTTP["HttpApiClient<br/>fetch + credentials: include<br/>Zod-validates every response"]
    CLIENT -. "development builds only" .-> MOCK["MockApiClient<br/>in-memory fixtures"]
    HTTP --> API["/api/v1 (same origin)"]

    EVM["ticketEventManager<br/>EventSource + 25 s polling fallback"] --> SSE["GET /api/v1/events/tickets"]
    TICKS -- "subscribe" --> EVM
    TDET -- "subscribe + 25 s poll" --> EVM
    AP -- "init on login, close on logout / 401" --> EVM

    CT["@bookleaf/contracts<br/>Zod schemas and types"] -.-> HTTP
    CT -.-> AUTHOR
    CT -.-> ADMINP
```

**Explanation.** `App` wraps the whole tree in the router and the single `AuthProvider`. Every page obtains the API client from `useAuth()`, so tests and development can swap the implementation. Only author pages subscribe to the live-event manager; admin pages load on navigation and after their own actions (verified: no `ticketEventManager` usage under `pages/admin`). Server-side authorisation is independent of this tree: hiding a link or a route in the UI is never the control.

## 6.3 Routing

```mermaid
%% file: frontend-routing.mmd
flowchart LR
    U(("URL")) --> L{"/login"}
    L -- "yes" --> LP["LoginPage"]
    LP -- "success: ADMIN" --> AD["/admin/dashboard"]
    LP -- "success: AUTHOR" --> DB["/dashboard"]
    LP -- "success with redirect state" --> BACK["originally requested path"]

    U --> ROOT{"/"}
    ROOT -- "index" --> DB
    ROOT --> PR{"ProtectedRoute<br/>user loaded?"}
    PR -- "loading" --> SP["splash 'Loading BookLeaf Author Portal'"]
    PR -- "no user" --> LR["Navigate to /login with from-location state"]
    PR -- "user" --> AL["AppLayout"]

    AL --> A1["/dashboard"]
    AL --> A2["/books"]
    AL --> A3["/books/:bookId"]
    AL --> A4["/tickets"]
    AL --> A5["/tickets/new"]
    AL --> A6["/tickets/:ticketId"]
    AL --> RR{"requiredRole = ADMIN?"}
    RR -- "role is ADMIN" --> B1["/admin/dashboard"]
    RR -- "role is ADMIN" --> B2["/admin/queue"]
    RR -- "role is ADMIN" --> B3["/admin/tickets/:ticketId"]
    RR -- "role is AUTHOR" --> DENY["'Access Restricted' panel (no redirect)"]
    U --> NF["any other path: NotFoundPage"]
```

The table of routes (`router/AppRoutes.tsx`):

| Path | Guard | Page |
| --- | --- | --- |
| `/login` | public | `LoginPage` |
| `/` | signed in | redirects to `/dashboard` |
| `/dashboard`, `/books`, `/books/:bookId`, `/tickets`, `/tickets/new`, `/tickets/:ticketId` | signed in (any role) | author pages |
| `/admin/dashboard`, `/admin/queue`, `/admin/tickets/:ticketId` | signed in **and** `role === "ADMIN"` | admin pages |
| `*` | – | `NotFoundPage` |

Note that the author routes are guarded only by "signed in", not by role. The data they request comes from `/author/*` endpoints that return **403** for an admin account.

## 6.4 Navigation structure

| Role | Sidebar entries (`components/layout/Sidebar.tsx`) |
| --- | --- |
| Author | Author Dashboard (`/dashboard`), My Books (`/books`), Support Tickets (`/tickets`), New Ticket (`/tickets/new`) |
| Admin | Admin Overview (`/admin/dashboard`), Ticket Queue (`/admin/queue`), Browse Titles (`/books`) |

Page hierarchy (what each page reads and writes):

```text
AppLayout
├── Author
│   ├── DashboardPage          GET books (pageSize 50), GET tickets (pageSize 25)
│   ├── BooksPage              GET /author/books?page&pageSize
│   │   └── BookDetailPage     GET /author/books/:id
│   ├── TicketsPage            GET /author/tickets (filters, pagination); SSE refresh
│   ├── NewTicketPage          GET books (100); POST /author/tickets; then POST attachment per file
│   └── TicketDetailPage       GET ticket + attachments; POST message; attachment download; SSE + 25 s poll
└── Admin
    ├── AdminDashboardPage     GET /admin/tickets (pageSize 50) for counters
    ├── AdminQueuePage         GET /admin/tickets (filters, pagination)
    └── AdminTicketDetailPage  GET detail + attachments; PATCH ticket; POST reply / note;
                               PUT assignment; POST ai-analysis; attachment download
```

Observation (not browser-tested here): the admin sidebar entry "Browse Titles" and the "Associated Book" link in `AdminTicketDetailPage` point at `/books…`, which calls `GET /author/books…`. The API restricts that route to `AUTHOR` users with an author profile, so these two links are expected to produce a permission error for an admin. This is derived from the source (`requireAuthor`), not from running the UI.

## 6.5 Authentication state flow

```mermaid
%% file: frontend-auth-state.mmd
stateDiagram-v2
    [*] --> Loading : AuthProvider mounts, refreshUser() calls GET /auth/me
    Loading --> Authenticated : 200 user
    Loading --> Anonymous : 401 or any error (SSE manager closed)
    Anonymous --> Authenticating : login(credentials)
    Authenticating --> Authenticated : 200 user, ticketEventManager.init()
    Authenticating --> Anonymous : error message shown (401, 403, 429, network)
    Authenticated --> Anonymous : logout() always clears local state, even if the request fails
    Authenticated --> Anonymous : any API call returns 401, onSessionExpired closes SSE
```

State lives in `AuthContext`: `user` (`CurrentUser | null`), `isLoading`, `error`. There is no token in JavaScript: the session cookie is `HttpOnly`. Session validity is re-checked by `GET /auth/me` on every full page load (`refreshUser`); there is no periodic refresh, and the session's lifetime is fixed on the server (default 7 days). A 401 from any API call triggers the registered `onSessionExpired` handlers, which close the live-event connection. The route guard then redirects to `/login` the next time `user` is `null`; the context's `user` is only cleared by `refreshUser` or `logout`.

## 6.6 API client communication

`HttpApiClient` (`api/http.ts`) is the single network layer:

* Base URL `VITE_API_BASE_URL` if set, otherwise the same-origin relative path `/api/v1` (the production image leaves it unset).
* Every request uses `credentials: "include"`.
* For `POST/PUT/PATCH/DELETE` it reads the CSRF value from the `XSRF-TOKEN` cookie (also accepts `csrfToken`, `_csrf`, or a `<meta name="csrf-token">`) and sends it as `X-CSRF-Token`.
* Responses are parsed with the matching contract schema; a mismatch raises `ApiClientError("CONTRACT_VALIDATION_ERROR")`.
* Non-2xx bodies are parsed with `apiErrorSchema` into `ApiClientError(code, message, status, details, requestId)`; a network failure becomes `NETWORK_ERROR` (status 0); `204` returns `undefined`.
* `MockApiClient` is selected only when `import.meta.env.PROD` is false and `VITE_USE_MOCKS !== "false"`; production builds always use the HTTP client and `toggleMockMode` is refused.

## 6.7 State management and error handling

* **State:** component-local `useState`/`useCallback`/`useEffect`; one global context (`AuthContext`); one module-level singleton (`ticketEventManager`) holding the `EventSource`, listeners and the last seen version per ticket.
* **Errors:** pages catch `ApiClientError`, show an `Alert` or inline message; a few admin actions use `window.alert` for failures. Failed attachment-list loads degrade to an empty list. There is no global React error boundary in the source.
* **Loading:** `Skeleton` placeholders and the `ProtectedRoute` splash screen.

## 6.8 Real-time update handling

```mermaid
%% file: frontend-realtime.mmd
sequenceDiagram
    autonumber
    participant UI as Author page (TicketsPage / TicketDetailPage)
    participant M as ticketEventManager
    participant ES as EventSource
    participant API as GET /events/tickets
    participant H as TicketEventHub

    Note over M: constructed at module import and init() is called immediately
    M->>ES: new EventSource(/api/v1/events/tickets, withCredentials)
    ES->>API: GET with session cookie
    alt not signed in
        API-->>ES: 401
        ES-->>M: onerror, readyState CLOSED
        M->>M: startPollingFallback (every 25 s emit synthetic ticket.updated)
    else signed in
        API-->>ES: 200 text/event-stream, "retry: 5000"
        ES-->>M: onopen
        M->>M: stopPollingFallback
    end
    H-->>API: publish(event) after a database commit
    API-->>ES: id, event name, data {ticketId, occurredAt, version}
    ES-->>M: addEventListener(type)
    M->>M: drop if version <= last seen version for the ticket
    M-->>UI: listener(event)
    UI->>API: refetch ticket or list over normal REST
    Note over ES,API: after a drop the browser reconnects with Last-Event-ID<br/>and the server replays ticket.updated for tickets changed since that time
```

Details verified in `api/events.ts` and the pages:

* The payload carries only `ticketId`, `occurredAt`, `version`; the page refetches the data over REST, so authorisation is re-applied on every read.
* De-duplication uses `(ticketId, version)`; `TicketDetailPage` additionally compares a snapshot of `updatedAt`, `status`, message count and attachment count before updating the UI.
* `TicketDetailPage` also polls every 25 s regardless of SSE; the manager's fallback polling emits a synthetic `ticket.updated` every 25 s (`ticketId: ""`), which makes subscribed pages refetch.
* Login calls `ticketEventManager.init()`, logout and 401 call `close()`. The release audit measured a reply appearing in 0.5 s over SSE and in 25.0 s with `EventSource` removed.
* Admin pages do not subscribe; the admin-only events (`ticket.analysis.updated`, internal-note `ticket.updated`) are therefore delivered to admin streams but not used by the current admin UI.

## 6.9 File upload and download flow

```mermaid
%% file: frontend-file-flow.mmd
flowchart TB
    subgraph UP["Upload (author, NewTicketPage after ticket creation)"]
        F1["User selects file"] --> F2["validateAttachmentFile<br/>non-empty, at most 5 MB, type PDF PNG JPEG WebP or text"]
        F2 -- "invalid" --> FE["inline error, nothing sent"]
        F2 -- "valid" --> F3["getAttachmentContentType<br/>declared type or file extension"]
        F3 --> F4["file.arrayBuffer()"]
        F4 --> F5["POST /author/tickets/:id/attachments?filename=...<br/>Content-Type = file type, raw bytes, X-CSRF-Token"]
        F5 --> F6["Zod-validated attachment metadata (no storage key)"]
    end
    subgraph DL["Download (author or admin)"]
        D1["Click download"] --> D2["GET .../attachments/:attachmentId with cookie"]
        D2 --> D3["blob() + extractSafeFileName(Content-Disposition)"]
        D3 --> D4["temporary object URL, anchor with download attribute, click, revoke"]
    end
```

The client-side checks are a convenience; the server repeats and strengthens every one (magic-byte verification, per-ticket limit, ownership, `CLOSED` check). Files are never rendered inline: the server sends `Content-Disposition: attachment` and the SPA saves the blob through an anchor with the `download` attribute.

## 6.10 Security-relevant frontend facts

* The nginx image sets `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`. Google Fonts is the only third-party origin.
* User-supplied text is rendered through React (escaped); the release audit verified a stored-XSS payload renders inert.
* The development-only "Workspace Switcher" in `Sidebar.tsx` embeds demo credentials for mock/dev use, guarded by `!import.meta.env.PROD`, so it does not render in production builds. (Commit `99a221e`, "remove demo credentials from production login", addressed the login page; whether the strings are also tree-shaken from the production bundle was not inspected for this document.)
