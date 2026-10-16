# Synthetic data cleanup plan (v2, NOT executed)

Status: plan only. Nothing here has been run. Execution needs separate, explicit approval from the owner.

## Why this exists
Production still holds the synthetic demo set (authors `SYN-A001..A010`, books `SYN-B001..B018`, ~163 test tickets with
their messages, notes, AI attempts and attachments, plus 52+ sessions). The assignment's original 10 authors / 18 books
(`AUTH001..AUTH010`, `BK001..BK018`) are imported **alongside** it first (separate approval), so reviewers see the real
dataset and the cleanup can be done last, or never.

## Safety properties of the existing tool (`npm run cleanup:synthetic --workspace @bookleaf/db`)
* Dry run by default; `--execute` also needs the exact confirmation token the dry run printed and a `--backup-stamp`.
* Deletes only whitelisted synthetic identities (`synthetic.authorN@example.test`, `SYN-*` ids). Original-dataset authors,
  the admin, and the audit log are not selected by any rule.
* Order: tickets, books, profiles/users, then attachment files after the database commit; refuses if the data changed since the dry run.

## Steps (when approved)
1. Re-run the read-only inventory and compare with `FINAL_CLEANUP_INVENTORY.md` (counts have grown: tickets 150 -> 163).
2. Confirm the original dataset import is present and verified (358 field comparisons, 0 mismatches).
3. `./scripts/backup.sh`, then `restore-test.sh` against the new backup; record the stamp.
4. Dry run inside the API container (`docker compose --profile tools run --rm ...`); review the counts: authors 10, books 18,
   tickets only from `SYN-*` authors, and **0** rows touching `AUTH*`/`BK*`/admin.
5. Execute with the token and backup stamp. Verify: original 10/18 intact, admin login works, audit rows preserved, health OK.
6. Rollback: restore the verified backup (`DEPLOY.md`, restore section) and redeploy the same image tag.

## Decisions needed from the owner
* Whether the synthetic demo tickets (which show the AI workflow populated) should be kept for the demo instead of removed.
* Whether the three self-registered authors (`WEB-*`) are kept (this plan keeps them).
