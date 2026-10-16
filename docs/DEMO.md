# Demo instructions

Synthetic data only (10 fake authors, 18 books). Never demo with the confidential BookLeaf dataset.

## Start

```powershell
npm install
npm run build
copy apps\api\.env.example apps\api\.env       # set DATABASE_URL, SESSION_SECRET (>= 32 chars), WEB_ORIGIN=http://localhost:5173
copy packages\db\.env.example packages\db\.env
npm run migrate:deploy --workspace @bookleaf/db
$env:BOOKLEAF_SEED_AUTHOR_PASSWORD="choose-a-demo-password"
$env:BOOKLEAF_SEED_ADMIN_EMAIL="admin@example.test"; $env:BOOKLEAF_SEED_ADMIN_PASSWORD="choose-another-password"
npm run seed:synthetic --workspace @bookleaf/db
npm run dev                                                    # API on :3000
$env:VITE_USE_MOCKS="false"; $env:VITE_API_BASE_URL="http://localhost:3000/api/v1"; npm run dev:web   # web on :5173
```

Sign in at <http://localhost:5173>: authors are `synthetic.author1@example.test` ... `synthetic.author10@example.test` with the seed author password; the admin is the e-mail/password you exported. For AI drafts set `OPENROUTER_API_KEY` in `apps/api/.env` (uses a paid provider; leave empty to demo without AI, admins then work manually and the AI card shows a failed/not-configured attempt). To demo AI at no cost, run the E2E suite's mock provider logic instead (see [Testing](TESTING.md)).

Quick no-setup alternative: `npm run test:e2e` runs the whole flow below in a browser against a disposable stack (add `--headed` to watch: `npm run test:e2e --workspace @bookleaf/web -- --headed`).

## Walkthrough (about 5 minutes)

1. **Author**: sign in -> *My Books* (only own titles) -> open a book -> *New ticket* with a subject, a description (try a royalty question) and a `.txt`/`.pdf`/`.png` attachment -> the ticket page shows the attachment; download it. Send a reply and refresh: it persists.
2. **Admin** (second browser profile): sign in -> *Queue* -> open the ticket. Show the author's reply and attachment, **Assign to Me**, set status/priority/category and apply.
3. **Internal note**: save a private note. Switch back to the author's browser, refresh: the note is not visible (also absent from the author's API payload).
4. **AI copilot** (if configured): the card shows category, confidence, citations and a grounded draft marked *Human Review Required*. **Insert Draft into Reply Box**, edit, **Send Reply**. The AI never sends anything itself.
5. **Author**: refresh the ticket: the staff reply is visible, the internal note is not.
6. **Boundaries**: as the author open `/admin/queue` -> *Access Restricted*; sign out, replay an old session cookie -> 401.

Talking points: AI receives only the ticket text, the last two public messages, policy excerpts and non-financial book facts (no name, e-mail, phone, ISBN, royalty or sales figures); royalty drafts say the team will verify figures internally; every AI draft is reviewed by a human.

## Reviewer access to the staging deployment

A staging deployment runs the same code behind HTTPS (see [Deployment](../infra/DEPLOY.md)). Its demo AI is a **mock** that returns canned, labelled text (`[DEMO MOCK]` / `[DEMO DRAFT]`), not model inference. Demo credentials are never stored in this repository: the owner shares the staging URL and the synthetic admin/author logins with a reviewer out of band (for example a password manager share or an encrypted message) and can rotate the admin password on the server with `npm run admin:ensure --workspace @bookleaf/db -- --rotate-password` (see [Admin account](release/ADMIN_ACCOUNT.md)). On a production-mode stack the synthetic seed is refused, so author demo accounts there are created through the public `/register` page instead. The repository is private; grant the reviewer read access as a collaborator rather than sharing a token.
