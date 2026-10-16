# Bug register

Audit period 2026-10-15/16, revision `88cad7a`; BUG-004 was fixed in `a21b407` and deployed as `bookleaf-web:ee9b387`. Severity scale: BLOCKER / HIGH / MEDIUM / LOW / INFO.
**No BLOCKER, HIGH or CRITICAL defect was found.** Everything else listed as open is unchanged and was not part of the frontend release.

## Product defects

| ID | Sev | Finding | Evidence | Status |
| --- | --- | --- | --- | --- |
| BUG-004 | MEDIUM | **Dashboard KPIs are computed from one page of results.** Admin dashboard fetched 50 tickets and showed "Unresolved 50 / Awaiting assignment 40" when the API held 72 / 61; the author dashboard counted active tickets within the 25 most recent ("24 active support inquiry" for an author with 68). Any deployment with more than 50 open tickets (admin) or 25 (author) misreports workload | Reproduced on staging (76 tickets). Root cause: `AdminDashboardPage.tsx` and `author/DashboardPage.tsx` derive counts from `items`, not `total`. New tests `apps/web/src/test/dashboard-counts.test.tsx` failed before the fix and pass after | **Fixed and deployed** (commit `a21b407`, image `bookleaf-web:ee9b387`). Live dashboard check against the API with 101 unresolved tickets: **1/7 before, 7/7 after** (admin 50 -> 101, 40 -> 90; author 24 -> 68, 25 -> 72). Admin pages through the queue (100 per page, stops at the first page with no unresolved ticket, cap 2,000 shows "N+"); author uses the API's `status` filter totals. Web suite 48/48, typecheck and build clean |
| BUG-006 | MEDIUM (operations) | **No backup schedule and no off-host copy.** Backups exist only because `scripts/backup.sh` was run by hand; they sit on the same disk as the data | `crontab -l` empty, no timer or cron entry mentions BookLeaf | Partly addressed 2026-10-16: encrypted backups, retention and a daily cron are installed and a restore was proven; **still open: no off-host copy** (needs an owner decision on storage) |
| BUG-001 | LOW | Login rejects an email with leading/trailing whitespace (HTTP 400, "Invalid login request") although the server trims and lower-cases afterwards. Pasted emails often carry a trailing space | `tests/live/api-matrix.mjs` KNOWN-ISSUE; `loginRequestSchema` validates `email()` before trimming | Open. Fix would be `z.string().trim().email()` in `packages/contracts` (a contract change) |
| BUG-002 | LOW | `POST /author/tickets` has no idempotency: two concurrent identical requests create two tickets (replies do have duplicate protection). A double click in the UI sends one request, so only API retries/scripts trigger it | matrix KNOWN-ISSUE (201/201); UI double-click test sent 1 request | Open |
| BUG-003 | LOW | `InternalNote` and `TicketAssignment` are described as immutable/append-only, but their triggers fire on `INSERT OR UPDATE` only: a direct SQL `DELETE` is not blocked. `AuditLog` is fully protected. The API has no delete route for either | Trigger source (`20261014000400_role_and_history_guards`) and tests on a disposable database | Open; docs corrected locally. A fix needs a new migration (approval); a sketch is in section "Proposed migration" below |
| BUG-005 | LOW | A signed-in user who visits `/login` sees the login form instead of being redirected | `ui-forms` follow-up: URL stays `/login`, form shown | Open |
| BUG-007 | LOW | Image tags (`localtest`, `loginfix-20261015`) do not encode a commit; traceability depends on hashing a clean build | compiled-output hash comparison (58 files) matched at `3b09980` | Open; runbook recommends short-SHA tags |
| BUG-008 | LOW | `/healthz` returns 200 while the database is down (liveness, not readiness); the container stays "healthy" during an outage | isolated DB-outage test | Open (the API itself recovered with 0 restarts) |
| BUG-009 | LOW | The sidebar shows a developer-style line "API Mode: Live API / Connecting to /api/v1" in the production UI | `Sidebar.tsx` lines ~186-209; seen in both dashboards | Open |
| BUG-010 | INFO | A malformed email shows the generic "Invalid login request" because the form uses `noValidate` and the server validates | UI check | Open |
| BUG-012 | LOW | Author ticket payloads include `assigneeId` (opaque id) from the shared `ticketSchema`; no author page reads it; it reveals only "assigned or not" | grep of `apps/web/src`; API matrix | Open; removing it needs an author-specific schema |
| BUG-013 | LOW | Admin queue search filters only the 25 tickets on the current page (API rejects `q`), and new unclassified tickets sort after prioritised ones, so a fresh ticket can be on page 2 and unsearchable from page 1 | code comment "Client search filtering on current page"; position 38 of 41 measured | Open; documented limitation |
| BUG-011 | LOW | `npm audit --omit=dev`: 3 high, one chain `prisma` -> `@prisma/config` -> `deepmerge-ts` < 8 (stack exhaustion on recursive objects). `@prisma/client` has no dependencies and no source imports the CLI. Every Prisma 6.x/7.x up to 7.10.0 pins the vulnerable version; the only fixed line is a major 8.x prerelease | `npm audit`, `npm view`, dry-run (lockfile unchanged) | Accepted; no blind upgrade or override applied |
| BUG-016 | INFO | The API image copies the whole workspace including dev dependencies (needed for the Prisma CLI and `tsx` used by the migrate/seed jobs). Full `npm audit` also lists dev-only advisories (2 critical in `vitest`/`tinypool`, high in build tooling); those packages are not executed at runtime | image build files; full audit | Open; consider a slimmer runtime image |

## Environment and host

| ID | Sev | Finding | Status |
| --- | --- | --- | --- |
| BUG-014 | INFO | Host reports a pending reboot and 23 security-related package upgrades | Owner decision; not touched |
| BUG-015 | INFO | The Aadya tenant (3 containers, volumes, networks, `/opt/aadya`) was removed from the VPS during the audit by a root SSH session that was not part of it (shell history shows `rm -rf /opt/aadya`). BookLeaf was unaffected. Cause and authorisation unknown | Needs owner confirmation |

## Documentation defects (fixed and committed in `add8e07`)

| ID | Finding | Fix |
| --- | --- | --- |
| DOC-001 | `02-SYSTEM-ARCHITECTURE.md`, `09-AI-ARCHITECTURE.md` and `docs/ENVIRONMENT.md` described the retired separate-container, shared-namespace demo mock | Rewritten for the supervised in-container process; mock drawn inside the API container |
| DOC-002 | Two Mermaid diagrams did not parse (a `;` inside a sequence-diagram message in `07` and `09`) | Replaced with commas; all 35 diagrams now render with Mermaid CLI 11 |
| DOC-003 | README, `KNOWN_LIMITATIONS.md` and the data dictionary said `InternalNote` is trigger-protected / `TicketAssignment` append-only without saying `DELETE` is not covered | Wording made exact (see BUG-003) |
| DOC-004 | 7 broken links: architecture documents 11, 12, 14, 15 and 17 were referenced or required but missing | Written (deployment, data flow, NFR, testing, limitations) plus an index |
| DOC-005 | `KNOWN_LIMITATIONS.md` said mobile layouts were not tested | Updated with the viewports actually checked |

## Test-environment issues (not product defects)

| ID | Issue | Resolution |
| --- | --- | --- |
| H-1 | First Node 24 Playwright run: 4 failed, 11 not run. Cause: a truncated Chromium download in one test image (288 zero-byte files, 0-byte `icudtl.dat`) | Browser reinstalled; E2E 30/30 on Node 24 |
| H-2 | Repo `.dockerignore` (correctly) excludes `apps/web/e2e`, so an image built from the repo root has no E2E specs | Separate ignore file for test images |
| H-3 | Several of my first live checks encoded wrong assumptions (response keys, allowed `IN_PROGRESS -> OPEN`, page-1 queue position, `docker kill` as a crash) | Corrected; the live scripts now state known issues explicitly |
| H-4 | One Node 24 image build failed once and succeeded unchanged on retry | Cause not captured |

## Proposed migration for BUG-003 (not applied, not in the migrations folder)

```sql
-- Reject direct deletes of history rows; allow the cascade when the parent ticket itself is deleted
-- (during a cascade the Ticket row is already gone, so the EXISTS check is false).
CREATE FUNCTION "History_no_direct_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Ticket" WHERE "id" = OLD."ticketId") THEN
    RAISE EXCEPTION '% rows cannot be deleted directly', TG_TABLE_NAME USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER "InternalNote_no_delete" BEFORE DELETE ON "InternalNote" FOR EACH ROW EXECUTE FUNCTION "History_no_direct_delete"();
CREATE TRIGGER "TicketAssignment_no_delete" BEFORE DELETE ON "TicketAssignment" FOR EACH ROW EXECUTE FUNCTION "History_no_direct_delete"();
```

It must be tested in an isolated database (cascade delete of a ticket still works; a direct delete is rejected) before any deployment.
