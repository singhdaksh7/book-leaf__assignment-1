# Feature list

**Authentication:** email + password (Argon2id), server-side sessions (opaque HttpOnly cookie, hash stored), CSRF token, origin check, login throttling, role-based access (AUTHOR, ADMIN); signed-in users are redirected away from /login.

**Author:** dashboard with ticket counts, own books list/detail, create ticket for own book, attachments (upload/download), reply to ticket, ticket history, live updates (SSE with polling fallback).

**Admin:** queue with filters and pagination, ticket workbench, status/category/priority changes (CLOSED is terminal), replies visible to the author, internal notes (admin only), self-assignment, attachment download, AI analysis (run/re-run), live updates.

**AI:** classification into six categories (royalty/payments, ISBN/metadata, printing quality, distribution/availability, book status/production, general), priority, confidence, rationale, cited policy chunks, grounded draft reply; prompt-injection and PII safeguards; bounded retries; failures recorded, never replaced by mock output; human review always required.

**Operations:** Docker Compose stack (db, api, web) behind a shared Traefik; encrypted verified backups with restore test (installed and scheduled on the VPS; restore proven in isolation; no off-host copy).

**Not implemented:** password reset, e-mail notifications, file deletion, server-side search, off-host backup.

## Added in the registration release (implemented and tested locally; not yet deployed)

* Public author self-registration with a responsive, keyboard-accessible form (inline validation, live password checklist, show/hide password, duplicate handling, loading and success states).
* Fixed administrator model: no public admin creation or promotion; server-side admin tool; no default credentials.
* Production data hygiene: seed guard, dry-run-by-default synthetic-data cleanup tool, professional empty states for new accounts.
