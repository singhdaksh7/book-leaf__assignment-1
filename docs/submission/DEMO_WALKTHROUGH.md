# Demo walkthrough (about 7 minutes, synthetic data only)

**Live site:** https://bookleaf.77.37.45.177.sslip.io

**Accounts (synthetic).** Authors `synthetic.author1@example.test` … `synthetic.author10@example.test`; admin `admin@example.test`. The passwords are sent separately by the submitter and are never stored in the repository. Use two browser windows (or one normal and one private window) so the author and admin sessions do not overwrite each other. Please use one author per demo; each author can create 30 tickets per hour.

## Flow

1. **Author sign-in.** Sign in as an author. The dashboard shows ticket counts; open *My Books* in the sidebar to see only that author's books.
2. **Create a ticket.** *New Ticket*: choose a book, subject "Royalty not received", a short description such as "I published my book four months ago and have not received any royalty yet." Attach a small PNG, PDF or text file. Submit.
3. **Admin sign-in (second window).** Sign in as `admin@example.test`. Open the queue (the new ticket appears; the queue ordering is intentional, so use the filters or the second page if you do not see it at once) and open the ticket.
4. **AI panel.** One of three things appears in *AI Copilot Analysis*:
   * **A completed analysis:** category, priority, confidence, rationale, cited policy sources, a suggested draft and the badge **Human Review Required**. If part of the model output failed strict grounding, the rationale starts with `[Rule-based fallback…]`; read it before using it.
   * **A failure notice:** `AI analysis failed (AI_RATE_LIMITED)` with "The AI provider's usage limit was reached" when the free daily quota is exhausted. No draft exists and nothing was sent; reply manually.
   * *Pending* for a few seconds right after creation.
5. **Review and send.** Click *Insert Draft into Reply Box* (when a draft exists), edit it, and press *Send Reply*. Nothing reaches the author before this explicit step.
6. **Admin actions.** *Assign to Me*, change the status to *In Progress*, add an internal note.
7. **Author side.** In the author window the reply appears live (Server-Sent Events, with a 25 s polling fallback). The internal note and every AI field are never visible to the author. The attachment can be downloaded by both sides.
8. **Isolation (optional).** Paste another author's ticket URL while signed in as the first author: the portal answers "not found", the same as for a missing ticket.
9. **Sign out** from both windows.

## What to say about the AI

The AI is advisory. It receives only minimised text, its output is treated as untrusted data, and a draft is shown only if it passes schema, citation and strict grounding checks (no invented amounts, dates, time frames, links, refunds or product features). Failures are shown, never replaced by mock or paid-model output. Free-tier capacity is about 25 analyses a day.

## Notes for reviewers

* Older demonstration tickets created before the real provider was switched on may carry stored `[DEMO MOCK]` analysis text; tickets created now never do.
* Do not use real personal data; this is a synthetic staging system.
