# BookLeaf Author Support Portal: approach, trade-offs, next steps (one page)

**Problem.** Authors raise support tickets about royalties, ISBNs, printing, distribution and production status. Staff need triage, safe AI help and an audit trail. The assignment asks for real AI, knowledge-base-grounded replies, classification, priority scoring, human-reviewed replies and graceful failure.

**Approach.**
- **Stack:** React/Vite and Express on TypeScript, PostgreSQL with Prisma, Zod contracts shared by web, API and AI package, Docker Compose behind Traefik/HTTPS on a VPS.
- **AI pipeline:** retrieve the assignment's policy text (80/20 split, quarterly payments within 45 days, ₹1,000 threshold, ISBN escalation, 5-7 day reprint, 7-10 day listings, 3-5 day metadata updates) -> classify into six categories with a priority -> draft a reply -> validate -> an admin edits and sends. OpenRouter free model `nvidia/nemotron-3-super-120b-a12b:free`, reported cost $0.
- **Grounding:** the model output is untrusted. A deterministic validator rejects invented numbers, dates, time frames from other topics, links, refunds, product features, payout promises and claims that something was already done. If anything fails, a clearly labelled policy-template draft is shown. Deterministic rules set priority floors (legal/fraud, ISBN errors) and catch known edge cases.
- **Human in the loop:** analysis never sends anything. A reply reaches an author only through the admin's explicit send action. Internal notes and AI fields are never visible to authors.
- **Failure handling:** timeouts, retries with backoff, rate limits, bad keys and invalid output are recorded as attempt states; ticket handling continues manually.
- **Security:** server-side sessions, CSRF, Argon2id, per-author scoping (another author's data returns 404), rate limits, attachment validation, key only on the server.

**Trade-offs.**
- A free model keeps the cost at zero but is non-deterministic and rate-limited (about 25 analyses a day). I chose strict validation over fluent drafts, so some drafts fall back to templates.
- Deterministic rules override the model in a few places for predictability and test coverage, at the cost of some rigidity.
- A single API instance keeps sessions, rate limits and live updates simple but cannot scale out as built.
- Local-disk attachments and same-host backups are simple but are not disaster-proof.

**Results.** Tests: AI package 509, API 292, web 68, E2E 41. Real OpenRouter calls locally on the final code: classification and priority correct 6/6 each run, model drafts accepted 5/6 each run (the book-status draft falls back because the model invents a timeline). **On the live site the free quota was exhausted, so live analyses currently end `AI_RATE_LIMITED`; the failure path works (no draft, nothing sent), but a successful live inference was not demonstrated.** The live database holds the assignment's 10 authors and 18 books, verified field by field (302 comparisons, 0 mismatches).

**Future improvements.** A funded or higher-quota model with a fallback model; an evaluation set that tracks accuracy over time; off-host encrypted backups; password reset and e-mail notifications; an admin screen to link books to new authors; shared rate-limit and session storage for multiple instances; semantic retrieval over a larger knowledge base.
