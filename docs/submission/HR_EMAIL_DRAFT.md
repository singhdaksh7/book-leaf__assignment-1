# HR submission email: READY TO REVIEW (do not send without the owner's approval)

Before sending: fill the bracketed items, send `reviewer-credentials.md` through a private channel (never in the repository or the email body), and confirm the repository branch named below is the one you want reviewed.

---

**To:** [HR contact]
**Subject:** BookLeaf Technical Assignment 1: Author Support Portal submission (Daksh Singh)

Dear [Name],

Please find my submission for BookLeaf Technical Assignment 1, the Author Support and Communication Portal.

**What it is.** A web portal where authors view their books and raise support tickets, and an admin works the queue with an AI assistant. For every ticket the AI classifies the category, scores the priority and drafts a reply grounded in the assignment's knowledge base (80/20 royalty split, quarterly payments within 45 days, ₹1,000 threshold, ISBN escalation, printing and distribution policies). A human admin always reviews, edits and sends the reply; the AI never sends anything.

**Live demo:** https://bookleaf.77.37.45.177.sslip.io
**Logins:** one admin and the ten sample authors (`AUTH001`-`AUTH010`, the assignment's 18 books) are in the credentials file sent separately [attached / in a separate message]. You do not need any API key to use the demo.

**Source code:** private GitHub repository `singhdaksh7/book-leaf__assignment-1`, branch [`main` / `integration/bookleaf-fullstack`]. [Please share your GitHub usernames and I will grant read access.]

**Where to start in the repository:** `README.md`, then `docs/submission/APPROACH_ONE_PAGER.md` (approach, trade-offs, next steps), `docs/submission/DEMO_WALKTHROUGH.md`, `docs/SOFTWARE_DESIGN_DOCUMENT.pdf` and `docs/submission/KNOWN_LIMITATIONS.md`.

**Technology.** React, Vite, TypeScript; Node.js, Express; PostgreSQL, Prisma; Zod; OpenRouter (free model `nvidia/nemotron-3-super-120b-a12b:free`); Docker Compose behind Traefik with HTTPS.

**Verification.** Automated tests: 509 AI-package, 292 API, 68 frontend, 41 browser end-to-end. The assignment's 10 authors and 18 books were imported into the live database and checked field by field (302 comparisons, 0 mismatches), plus author login, My Books and cross-author isolation checks on the live site.

**Honest notes on the AI.**
- Real OpenRouter calls were verified locally on the final code: classification and priority were correct for all six categories in each of the last three runs, and the model's draft passed my strict grounding checks for 5 of 6 tickets each time (the sixth falls back to a labelled policy template).
- **On the live site the free OpenRouter daily quota was already exhausted when I tested, so live analyses currently show "AI analysis failed (AI_RATE_LIMITED)" and replies are written manually. I did not demonstrate a successful live AI inference on the hosted site.** The failure handling itself works: no draft is shown, nothing is sent, and the ticket stays intact. The same code runs once the quota resets or a funded key is configured.
- Backups are encrypted and verified but there is no off-host copy yet. Other limitations are listed in `docs/submission/KNOWN_LIMITATIONS.md`.

I am happy to walk through the system or answer questions at any time.

Kind regards,
Daksh Singh
manavdaksh7@gmail.com
[phone]
