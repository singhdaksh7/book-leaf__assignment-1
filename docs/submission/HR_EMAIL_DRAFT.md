# HR submission email: DRAFT (do not send until the owner approves)

Review before sending: fill the bracketed items, confirm the live status line matches `FINAL_ACCEPTANCE_REPORT.md` after the 2026-10-17 checks, and decide how the reviewer gets repository access (no collaborator has been added) and the demo passwords (never put them in the email body together with the account names; send them in a separate message or channel).

---

**To:** [HR contact]
**Subject:** BookLeaf Author Support Portal: assignment submission (Daksh Singh)

Dear [Name],

Please find my submission for the BookLeaf Author Support and Communication Portal assignment.

**What it is.** A web portal where authors raise support tickets about their books and administrators work them with an AI assistant that classifies each ticket and drafts a policy-grounded reply. A human always reviews, edits and sends the reply; the AI never sends anything on its own.

**Live system:** https://bookleaf.77.37.45.177.sslip.io
It is a synthetic staging system. Demo accounts: admin `admin@example.test` and authors `synthetic.author1@example.test` to `synthetic.author10@example.test`. I will send the passwords in a separate message.

**Source code:** private GitHub repository `singhdaksh7/book-leaf__assignment-1`, branch `integration/bookleaf-fullstack`. [Access: please share the GitHub usernames of the reviewers and I will grant read access. / I have invited: ...]

**Where to start (everything is in the repository):**
- `docs/submission/README.md`: reviewer README with the stack, architecture, features and links
- `docs/SOFTWARE_DESIGN_DOCUMENT.pdf`: 30-page Software Design Document (ERD, data dictionary, DFD levels 0, 1 and 2, UML, security, deployment, testing)
- `docs/architecture/diagrams/`: 46 editable diagram sources with SVG and PNG renders
- `docs/submission/DEMO_WALKTHROUGH.md`: a 7-minute walkthrough with the synthetic accounts

**Technology.** React, Vite and TypeScript; Node.js and Express; PostgreSQL with Prisma; Zod contracts; OpenRouter (free model) for the AI; Docker Compose behind Traefik on a VPS with HTTPS.

**Verification.** Automated tests: 485 AI-package, 230 API, 53 frontend, 30 browser end-to-end, plus live checks against the deployed site (139 API checks, 49 audit checks, a 16-step UI journey, a mobile sweep and real-time update tests). Deployment was done with rollback protection, a verified encrypted backup and an isolated restore test.

**Honest notes.**
- The AI runs on a free OpenRouter tier with a daily limit (about 25 analyses a day). When it is exhausted the portal shows a clear "AI analysis failed" notice and replies are written manually; it never falls back to mock or paid output. [Live real-AI result: fill in from the acceptance report.]
- Backups are encrypted, verified and scheduled, but there is no off-host copy yet.
- Known deferred items (for example duplicate tickets on simultaneous identical submissions, and no password reset or e-mail notifications) are listed in `docs/submission/KNOWN_LIMITATIONS.md`.

I am happy to walk through the system or answer questions at any time.

Kind regards,
Daksh Singh
manavdaksh7@gmail.com
[phone]
