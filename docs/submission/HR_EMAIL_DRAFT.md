# HR submission email: DRAFT (not sent; the owner must approve before sending)

Before sending: attach the three files listed below (paths are in the final report) and share the Reviewer Access Guide (kept in the owner's secrets folder, outside Git) only through a private channel, never in the email body. Phone and e-mail come from the resume.

**To:** HR@bookleafpub.in
**Subject:** Technical Assignment 1 Submission — Daksh Singh | Full-Stack Developer

**Attachments:** `BookLeaf_One_Page_Approach_Daksh_Singh.pdf` (one page), `SOFTWARE_DESIGN_DOCUMENT.pdf` (30 pages), `system-architecture.png`

---

Dear BookLeaf Team,

Please find my submission for Technical Assignment 1, the Author Support and Communication Portal.

**Live demo:** https://bookleaf.77.37.45.177.sslip.io
**Logins:** a dedicated reviewer admin account and the ten authors from your dataset (`AUTH001` to `AUTH010`, with all 18 books). Because the logins contain passwords, they are in a separate Reviewer Access Guide that I will share through a private channel, not in this email. No API key is needed to use the demo.
**Code:** private GitHub repository `singhdaksh7/book-leaf__assignment-1`, branch `main`. The repository is private; please send me the GitHub usernames of the reviewers and I will grant read access immediately. The README has a short reviewer quick start.

**What it does.** Authors register or log in, see their books with exact royalty figures and production status, and raise general or book-linked tickets with attachments. Admins work a queue with search and filters, assignment, internal notes, status changes and an audit history. For each ticket the AI classifies the category, scores the priority and drafts a reply grounded in your policies (80/20 split, quarterly payments within 45 days, the Rs 1,000 threshold, ISBN escalation, printing and distribution timelines). The admin edits and explicitly sends it; nothing is ever sent automatically.

**Stack.** React, Vite, TypeScript; Node.js, Express; PostgreSQL, Prisma; Zod; OpenRouter (free model `nvidia/nemotron-3-super-120b-a12b:free`); Docker Compose behind Traefik with HTTPS.

**Verification.** Your 10 authors and 18 books were imported into the live database and compared field by field with the original JSON (358 comparisons, 0 mismatches). Automated tests pass: 509 AI package, 292 API, 68 front end, 41 browser end-to-end. I also checked the live site: all ten author logins, each author seeing only their own books and tickets, and the ticket, admin reply and author receipt flow.

**One thing to know about the AI.** The AI uses real OpenRouter calls. I verified it locally on the final code: classification and priority were correct for all six categories, and most drafts passed my grounding checks. However, the free OpenRouter daily quota on the hosted site was exhausted, so right now live AI analyses show a clear rate-limit notice and replies are written manually. I have not demonstrated a successful AI inference on the hosted site, and the manual flow works fully. The quota resets daily (00:00 UTC) and the same code runs once it does or a funded key is configured. Other known limitations (for example no off-host backup and no password reset) are listed in `docs/submission/KNOWN_LIMITATIONS.md`.

I am happy to walk you through the system at any time.

Kind regards,
Daksh Singh
singhdaksh9760@gmail.com
+91 97609 42003
