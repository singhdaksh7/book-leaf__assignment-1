# Final cleanup inventory (Phase 1, read-only)

Captured **2026-10-16 ~06:05 UTC** from the live production database `bookleaf-db` (read-only `SELECT`s inside a `default_transaction_read_only=on` session) and the attachment volume (mounted read-only). **Nothing was deleted, updated or restarted.** Counts move while the live test scripts run, so the cleanup tool re-counts at run time and refuses to proceed if the totals differ from an approved preview (see Phase 4).

Live release at capture time: API `bookleaf-api:83184cd`, web `bookleaf-web:134f49b`; migrations applied: 5 (`20261014000000_init` … `20261014000400_role_and_history_guards`). Local branch `integration/bookleaf-fullstack` was one commit ahead of origin (`5f1662f`, submission documents).

## 1. Headline finding

**Every business record in production is synthetic. No real or potentially real record was found.**

| Evidence | Result |
| --- | --- |
| Author logins with a non-reserved email domain | 0 of 10 (all `synthetic.authorN@example.test`) |
| Author profiles with an `externalAuthorId` outside `SYN-A001..A010` | 0 |
| Books with an `externalBookId` outside `SYN-B001..B018` | 0 |
| Tickets authored by a user outside the whitelist | 0 of 150 |
| Messages / notes / assignments / attachments / AI attempts not reachable from a synthetic ticket | 0 |
| Audit rows whose `entityId` is not an existing synthetic ticket | 0 of 223 |
| Attachment rows without a file, or files without a row | 0 / 0 (44 rows = 44 files) |
| Ticket creation window | 2026-10-15 06:55 to 2026-10-16 05:52 UTC (acceptance and smoke runs) |

The one account that is **not** synthetic test data is the administrator, `admin@example.test` (id `cmv96neob0000ll0vc45sncze`). It is kept. Note that its address is on a reserved `.test` domain and it was created by the seed on 2026-10-15; see "Admin account" below.

## 2. Exact record counts and classification

| Table | Rows | Classification | Rule used to classify | Fate in the proposed cleanup |
| --- | ---: | --- | --- | --- |
| `User` role AUTHOR | 10 | Synthetic (whitelisted identities) | email in the explicit whitelist `synthetic.author1..10@example.test` | delete |
| `User` role ADMIN | 1 | **Operational, protected** | the only ADMIN | **keep, never delete** |
| `AuthorProfile` | 10 | Synthetic | `externalAuthorId` `SYN-A001..A010` and owned by a whitelisted user | delete |
| `Book` | 18 | Synthetic | `externalBookId` `SYN-B001..B018` and owned by a whitelisted profile | delete |
| `Ticket` | 150 | Synthetic | authored by a whitelisted profile | delete |
| `TicketMessage` | 111 (25 AUTHOR-written, 86 ADMIN-written, all author-visible) | Synthetic | belongs to a synthetic ticket | cascade with ticket |
| `InternalNote` | 25 | Synthetic | belongs to a synthetic ticket (written by the kept admin) | cascade with ticket |
| `TicketAssignment` | 31 | Synthetic | belongs to a synthetic ticket | cascade with ticket |
| `AiAnalysis` | 211 (118 COMPLETED with the demo model `demo/mock-not-a-real-model`; 89 FAILED `AI_RATE_LIMITED`; 3 FAILED `AI_NETWORK_ERROR`; 1 FAILED `AI_NOT_CONFIGURED`) | Synthetic | belongs to a synthetic ticket | cascade with ticket |
| `TicketAttachment` rows | 44 (666 bytes in total; names such as `statement.txt`, `%2e%2e%2fsecret.txt`, `passwd.txt`, `smoke.png`) | Synthetic | belongs to a synthetic ticket; all uploaded by AUTHOR users | cascade with ticket |
| Attachment files on volume `bookleaf_bookleaf_attachments` | 44 files, 180 KB on disk | Synthetic | each file name equals a `storageKey` of a synthetic row | delete files **after** the database commit |
| `AuditLog` | 223 (86 `ticket.reply.created`, 33 `status.updated`, 31 `assignment.updated`, 25 `author_reply.created`, 25 `internal_note.created`, 16 `priority.updated`, 6 `category.updated`, 1 `ai_analysis.requested`) | Synthetic evidence | `entityType='Ticket'` and `entityId` is a synthetic ticket; 198 actor = the kept admin, 25 actor = a synthetic author; 86 carry `before`, all 223 carry `after` | **keep, never deleted.** The database makes the table append-only (trigger `AuditLog_append_only`, migration `20261014000100`), and the brief says audit history is not to be rewritten. The 25 rows acted by synthetic authors lose only their `actorId` (the schema's `ON DELETE SET NULL`, which the trigger explicitly permits) |
| `Session` | 52 (43 AUTHOR, 9 ADMIN; all currently valid) | Ephemeral | 43 cascade with the deleted author users; 9 belong to the kept admin | author sessions cascade; admin sessions untouched |

Ticket subjects fall into 24 test families (for example `Dashboard volume` 29, `Duplicate submit` 12, `Live UI` 9, `Recovery probe` 8, `[REAL-AI SMOKE]` 6, `<img src=x` 6 XSS probes, plus the seeded scenario tickets). 12 tickets have no book. 118 AI analyses still contain `[DEMO MOCK]/[DEMO DRAFT]` text from the mock-era runs.

## 3. Dependency graph and deletion behaviour (from `schema.prisma` and migrations)

```
User(AUTHOR) 1─1 AuthorProfile 1─* Book            Book.authorId   -> AuthorProfile  ON DELETE RESTRICT
                       │                           Ticket.bookId   -> Book           ON DELETE SET NULL
                       └─1─* Ticket                Ticket.authorId -> AuthorProfile  ON DELETE RESTRICT
Ticket 1─* TicketMessage | InternalNote | TicketAssignment | AiAnalysis | TicketAttachment   all ON DELETE CASCADE
TicketMessage.authorId / InternalNote.authorId / TicketAttachment.uploaderId / TicketAssignment.assignedById -> User  ON DELETE RESTRICT
TicketAssignment.assigneeId, Ticket.assigneeId -> User  ON DELETE SET NULL
AuditLog.actorId -> User ON DELETE SET NULL;  AuditLog.entityId is plain text (NO foreign key)
Session.userId -> User ON DELETE CASCADE;   AuthorProfile.userId -> User ON DELETE CASCADE
```

Consequences that fix the order:

1. **Tickets first.** `Ticket -> AuthorProfile` is RESTRICT, so profiles cannot be removed while tickets exist. Deleting a ticket cascades to its messages, notes, assignments, AI attempts and attachment rows.
2. **Books second** (`Book -> AuthorProfile` is RESTRICT; tickets no longer reference them).
3. **Author users third**; `AuthorProfile` and `Session` cascade. Messages, notes, attachments and assignments that reference a user with RESTRICT are already gone with their tickets, so no RESTRICT violation can occur.
4. **Audit rows are independent** (no FK from `entityId`) and are **not deleted**. A trigger rejects every UPDATE or DELETE on `AuditLog` except `actorId` becoming NULL with all other columns unchanged. The cleanup therefore leaves all 223 rows in place; 25 of them (actor = a synthetic author) become actor-less when that user is removed. The rows keep their text (`before`/`after`), which is synthetic. The first dry run of the cleanup tests discovered this trigger; an earlier draft of this document planned to delete the rows and wrongly stated that no trigger blocks DELETE.
5. **Attachment files** live outside the database: collect `storageKey`s before step 1, delete the files only after the transaction commits, and treat a missing file as success. A crash between commit and file deletion leaves harmless orphan files that the tool lists on the next run (never silently deleted).
6. **Database triggers.** `AuditLog_append_only` blocks DELETE and nearly all UPDATE (see 4). The `role_and_history_guards` triggers on `Ticket`, `TicketAssignment`, `InternalNote` and `TicketMessage` fire on INSERT/UPDATE only and do not block DELETE. The only UPDATE a delete can cause is `TicketAssignment.assigneeId` SET NULL when an *assignee user* is removed, which does not occur because the only possible assignee (the admin) is kept. `Ticket_book_author` makes it impossible for a real author's ticket to reference a synthetic book.
7. No cascading path reaches the `ADMIN` user: nothing declares `ON DELETE CASCADE` towards `User` from a ticket-side table.

## 4. Admin account (protected)

| Item | Value |
| --- | --- |
| Count | exactly 1 |
| Id | `cmv96neob0000ll0vc45sncze` |
| Email | `admin@example.test` |
| Created | 2026-10-15 06:53:48 UTC by the seed |
| Role guard | `ADMIN` can only be created by the seed or by the administrative process (there is no API that creates or promotes admins, and after this release the public registration endpoint cannot either) |
| Concern | The address is on a reserved `.test` domain and its password was set from environment variables at seed time. Rotating the password (and optionally the email) is an owner-side administrative action (`docs/release/ADMIN_ACCOUNT.md`) and is **not** performed by the cleanup tool, which never touches the admin |

## 5. Production seeding risk

`packages/db/prisma/seed.ts` can recreate the synthetic accounts: `npm run seed:synthetic` loads `data/synthetic_seed.json` and creates author logins with a password from the environment. Release deliverables: a `NODE_ENV=production` guard so the synthetic seed refuses to run against a production database unless an explicit, logged `BOOKLEAF_ALLOW_SYNTHETIC_SEED=yes-i-understand` is present, and a test proving it (Phase 4).

## 6. Storage, backups and rollback readiness (observed)

| Item | State |
| --- | --- |
| Containers | `bookleaf-api` (83184cd, healthy), `bookleaf-web` (134f49b, healthy), `bookleaf-db` (healthy); 13 neighbouring containers all healthy, none touched |
| Attachment store | local-disk volume `bookleaf_bookleaf_attachments`, mounted at `/data/attachments` in the API container; 44 files; no object storage |
| Backups present | encrypted sets `20261016T050116Z`, `20261016T054443Z` in `infra/backups/daily`; `last-status.json` = ok, `offHost:false` |
| Cron | `/etc/cron.d/bookleaf-backup` installed (daily 02:30 UTC, weekly restore test Monday 03:30 UTC) |
| First scheduled backup | **not yet due** (VPS clock 2026-10-16 06:03 UTC; first run 2026-10-17 02:30 UTC) |
| Real-AI quota reset | **not yet due** (reset 2026-10-17 00:00 UTC) |
| Rollback | five anchor containers and offline tarballs exist per `DEPLOYMENT_RECORD.md`; unchanged |

## 7. Proposed cleanup sequence (not executed)

Implemented in `packages/db/src/cleanup` and `packages/db/prisma/cleanup.ts` (`npm run cleanup:synthetic --workspace @bookleaf/db`); dry-run by default. Prerequisite gates, all separate from this document:

1. Release `registration + cleanup tool` deployed and verified (own approval).
2. Fresh encrypted backup, verified, and an isolated restore proving the counts above. The tool requires `--backup-stamp <stamp>` (the stamp is recorded in the audit trail); checking that the backup is fresh and restorable is a step in the runbook, because the container running the tool cannot see the host backup directory.
3. Dry-run output reviewed and approved by the owner, with the confirmation token printed by the dry run.

Then, in one transaction (`Serializable`), inside the API container with the existing `DATABASE_URL`:

| Step | Action | Expected rows |
| ---: | --- | ---: |
| 0 | Re-count and compare with the approved preview; abort on any difference or any unclassified row | |
| 1 | Write the evidence digest (counts, id lists, SHA-256 of the row id lists; no message bodies) | |
| 2 | Collect attachment `storageKey`s and synthetic ticket ids | 44 / 150 |
| 3 | Delete `Ticket` (cascades messages 111, notes 25, assignments 31, AI 211, attachment rows 44) | 150 |
| 4 | Delete `Book` | 18 |
| 5 | Delete `User` where `email` in the whitelist (cascades profiles 10, sessions 43; 25 audit rows lose only their actor id) | 10 |
| 6 | Verify inside the transaction: every table's remaining count equals the previewed expectation, the ADMIN id set is unchanged, whitelisted users = 0; roll back on any mismatch; write one aggregate maintenance audit record; commit | |
| 7 | After commit: delete the 44 attachment files by key, count remaining files | 44 |
| 8 | Post-check: User 1, AuthorProfile 0, Book 0, Ticket 0, TicketMessage 0, InternalNote 0, TicketAssignment 0, AiAnalysis 0, TicketAttachment 0, **AuditLog 223 + 1** (the original rows are untouched; the +1 is the cleanup's own record), Session 9 | |

Backups are never touched: the tool only operates on the database and on attachment keys listed in step 2. Historical audit rows are neither deleted nor rewritten, so they remain available as evidence in the live database as well as in the encrypted pre-cleanup backup.

## 8. Items deliberately **not** in the cleanup

* The admin user, its 9 sessions, and the migrations table.
* Any row the tool cannot classify (none today; if a real author registers before the cleanup, that account is not on the whitelist and is untouched, and so are its tickets).
* Backups, rollback anchors, images, other containers.
