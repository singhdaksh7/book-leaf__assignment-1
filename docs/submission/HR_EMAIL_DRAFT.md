# HR submission email: DRAFT (do not send: the release it describes is not yet deployed or verified live)

Review before sending: **send only after** the registration release is deployed and verified live, the production data cleanup has been run with your approval, and the live real-AI result is recorded (all PENDING in `FINAL_ACCEPTANCE_REPORT.md`). Then fill the bracketed items, confirm the status lines below match that report, and decide how the reviewer gets repository access (no collaborator has been added) and the demo passwords (never put them in the email body together with the account names; send them in a separate message or channel).

---

**To:** [HR contact]
**Subject:** BookLeaf Author Support Portal: assignment submission (Daksh Singh)

Dear [Name],

Please find my submission for the BookLeaf Author Support and Communication Portal assignment.

**What it is.** A web portal where authors raise support tickets about their books and administrators work them with an AI assistant that classifies each ticket and drafts a policy-grounded reply. A human always reviews, edits and sends the reply; the AI never sends anything on its own.

**Live system:** https://bookleaf.77.37.45.177.sslip.io
It is a staging system. **Authors can create their own account** with *Create account* on the sign-in page (a new account starts empty: no books, no tickets). The single **administrator** account is created by me on the server and cannot be created or requested through the site; I will send its login in a separate message. [After the data cleanup, the older synthetic demo authors no longer exist; delete this note if the cleanup has not been run and mention them instead.]

**Source code:** private GitHub repository `singhdaksh7/book-leaf__assignment-1`, branch `integration/bookleaf-fullstack`. [Access: please share the GitHub usernames of the reviewers and I will grant read access. / I have invited: ...]

**Where to start (everything is in the repository):**
- `docs/submission/README.md`: reviewer README with the stack, architecture, features and links
- `docs/SOFTWARE_DESIGN_DOCUMENT.pdf`: 30-page Software Design Document (ERD, data dictionary, DFD levels 0, 1 and 2, UML, security, deployment, testing)
- `docs/architecture/diagrams/`: 47 editable diagram sources with SVG and PNG renders
- `docs/submission/DEMO_WALKTHROUGH.md`: a 7-minute walkthrough with the synthetic accounts

**Technology.** React, Vite and TypeScript; Node.js and Express; PostgreSQL with Prisma; Zod contracts; OpenRouter (free model) for the AI; Docker Compose behind Traefik on a VPS with HTTPS.

**Verification.** Automated tests: 485 AI-package, 292 API, 68 frontend, 41 browser end-to-end (including self-registration on desktop, mobile and keyboard), plus live checks against the deployed site (139 API checks, 49 audit checks, a 16-step UI journey, a mobile sweep and real-time update tests). Deployment was done with rollback protection, a verified encrypted backup and an isolated restore test.

**Honest notes.**
- The AI runs on a free OpenRouter tier with a daily limit (about 25 analyses a day). When it is exhausted the portal shows a clear "AI analysis failed" notice and replies are written manually; it never falls back to mock or paid output. [Live real-AI result: fill in from the acceptance report.]
- Backups are encrypted, verified and scheduled, but there is no off-host copy yet. [First scheduled backup result: fill in from the acceptance report.]
- Registration has no e-mail verification (so it reveals whether an address is already registered), and a new author has no books until they are linked by the team; there is no admin screen for that yet.
- Known deferred items (for example duplicate tickets on simultaneous identical submissions, and no password reset or e-mail notifications) are listed in `docs/submission/KNOWN_LIMITATIONS.md`.

I am happy to walk through the system or answer questions at any time.

Kind regards,
Daksh Singh
manavdaksh7@gmail.com
[phone]
