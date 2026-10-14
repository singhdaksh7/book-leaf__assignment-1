# Integration checklist

## Scaffold verification

```powershell
npm install
npm run typecheck
npm run build
npm run test:scaffold
npm ls --workspaces --depth=0
# Validation only: a disposable local URL, no connection is made.
$env:DATABASE_URL = 'postgresql://scaffold:scaffold@localhost:5432/bookleaf?schema=public'
npm run validate --workspace @bookleaf/db
Remove-Item Env:DATABASE_URL
node --input-type=module -e "await import('@bookleaf/contracts'); await import('@bookleaf/db'); console.log('Package imports passed')"
git status --short --untracked-files=all
git status --short --ignored reference data
git ls-files --cached --others --exclude-standard
```

Use a fresh PowerShell session for the disposable validation URL so an existing environment value is not overwritten. Prisma validation/generation and package import do not require a database connection. Inspect the prospective tracked file list without staging: no reference documents, confidential dataset, secrets, `dist/`, or emitted source-side build artifacts may appear. `.env.example` templates contain local placeholders only. Never force-add ignored files.

PostgreSQL setup, Docker Compose, migrations, and seeding are deferred. The backend will add a seed command only once the importer is implemented as specified in `data/README.md`. Real configuration belongs in ignored `.env` files. `npm run dev` and `npm run dev:web` currently expose placeholders only.

Scaffold tests use synthetic fixtures to check contract boundaries and package/Prisma alignment. `npm test`, `npm run test:api`, and `npm run test:e2e` are future application suites, currently without tests. The aggregate lint script has no configured lint checks. Passing a typecheck/build is not functional acceptance.

## Future application acceptance criteria (not completed)

- Seed completes with the exact 10-author/18-book data, retaining all identifiers, money figures, nulls, zeros and empty arrays.
- Author login cannot access another author’s book, ticket, or event; admin can access the queue.
- My Books renders published and in-production books, including null/zero and no-availability states safely.
- Author can create a general or book-linked ticket and see status plus admin replies.
- Admin filters queue by status/category/priority/date; can override AI output, assign, update lifecycle, reply, and add notes invisible to authors.
- New/admin-updated ticket information reaches the correct author by SSE or polling fallback.
- AI output is KB-grounded/validated, never auto-sent, degrades to manual work when unavailable, and records usage/failure safely.
- Unit tests cover schemas/authorization/AI parsing; Supertest covers API authorization/error contracts; Playwright covers critical author/admin flows.
- `npm run typecheck`, tests, and build pass before deployment work begins. Record actual results; never claim unrun tests passed.
