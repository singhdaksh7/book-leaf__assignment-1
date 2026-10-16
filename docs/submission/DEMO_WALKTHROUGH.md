# Demo walkthrough (about 5 minutes)

Use synthetic accounts only; passwords are shared out of band (see `docs/DEMO.md`). State beforehand which AI mode the target runs: **staging today = demonstration mock** (answers labelled `[DEMO MOCK]`). A real-model demo needs the key setup in `docs/release/AI_REAL_PROVIDER.md`.

1. Sign in as `synthetic.authorN@example.test`; show the dashboard counts and a book.
2. Create a ticket (choose a book, subject "Royalty not received", short description); attach a small PNG or PDF.
3. Sign out; sign in as `admin@example.test`; open the queue and the new ticket.
4. Show the AI panel: category, priority, confidence, rationale, cited policy, draft. Point out "human review required" and any fallback notice.
5. Edit the draft, send it as a reply; add an internal note (admin only).
6. In the author's browser (second window) the reply appears live; the internal note does not.
7. Sign out. Optionally show 403/404 for a cross-author URL.
