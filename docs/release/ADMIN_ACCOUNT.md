# Administrator account: how it is created and managed

**Rule: there is exactly one administrator and no public path can create, promote or modify an administrator.**

## What enforces it

| Control | Where |
| --- | --- |
| `POST /auth/register` accepts only `name`, `email`, `password`, `confirmPassword` (strict schema). `role`, `isAdmin`, `userId` and any other key answer `400`. The handler writes the literal `AUTHOR`. | `packages/contracts` (`registerRequestSchema`), `apps/api/src/auth/routes.ts` |
| There is no API route that creates a user, changes a role or sets a password. | all of `apps/api/src/routes/*` |
| Database guards: assignees, assigners and internal-note authors must be ADMIN users; admin-only messages must come from an ADMIN. | migration `20261014000400_role_and_history_guards` |
| The synthetic seed (which used to create the admin) refuses to run when `NODE_ENV=production` unless `BOOKLEAF_ALLOW_SYNTHETIC_SEED=yes-i-understand`. | `packages/db/src/seed/import.ts` |
| The cleanup tool never selects an ADMIN user, even if its email is placed on the whitelist (test). | `packages/db/src/cleanup` |
| There is no default admin email or password in the code, the images or the compose files. The admin tool requires both from the environment. | `packages/db/src/admin`, `packages/db/prisma/admin.ts` |

## Current production state (read-only inspection, 2026-10-16)

One ADMIN user: id `cmv96neob0000ll0vc45sncze`, email `admin@example.test` (a reserved `.test` address), created by the seed on 2026-10-15, 9 live sessions. Its password was set from the server `.env` at seed time. **Recommended before submission:** rotate its password with the tool below. Whether to also move it to a real mailbox is the owner's decision (see "Changing the email").

## Create or rotate (server shell only)

The tool runs inside the API container, reads credentials from the environment (never from arguments, so nothing lands in shell history or the process list), validates the password (12 to 128 characters with lowercase, uppercase and a digit), hashes it with Argon2id, writes an audit row (`admin.created` or `admin.password_rotated`) and never prints the password.

```bash
# on the VPS, as root; the password is read from a prompt, not typed on the command line
read -r -s -p 'New admin password: ' BOOKLEAF_ADMIN_PASSWORD; echo; export BOOKLEAF_ADMIN_PASSWORD
docker exec -w /repo -e BOOKLEAF_ADMIN_EMAIL=admin@example.test -e BOOKLEAF_ADMIN_PASSWORD bookleaf-api \
  npm run admin:ensure --workspace @bookleaf/db -- --rotate-password
unset BOOKLEAF_ADMIN_PASSWORD
```

Behaviour: a new email creates an ADMIN; an existing admin email requires `--rotate-password`, and rotation ends all of that admin's sessions; an email that belongs to an author is refused (authors are never promoted).

## Changing the admin's email (optional, manual)

The tool does not rename accounts. Because the admin has history (messages, notes, assignments reference it with `RESTRICT`), the safe way is to keep the row and change its address in a backed-up, single-row statement, then rotate the password:

```sql
-- after a verified backup; inside a transaction; exactly one row must be updated
BEGIN;
UPDATE "User" SET email = 'owner@example.com' WHERE id = 'cmv96neob0000ll0vc45sncze' AND role = 'ADMIN';
-- expect UPDATE 1, then COMMIT; otherwise ROLLBACK
```

## What not to do

* Do not put admin credentials in the repository, an image, a compose file or a chat message.
* Do not run `seed:synthetic` against production; it is refused by default and would recreate the test accounts.
* Do not insert users with SQL; use public registration for authors and this tool for the admin.
