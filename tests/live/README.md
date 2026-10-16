# Live staging checks

Scripts that exercise a **deployed** BookLeaf environment through its real HTTPS URL, using the synthetic demo accounts.
They are not part of `npm test` (they need a deployed target and credentials) and they **create synthetic tickets** there.

```bash
export BASE_URL=https://bookleaf.77.37.45.177.sslip.io     # default if unset
export BL_AUTHOR_PW='...'   # password of synthetic.authorN@example.test (all authors share it)
export BL_ADMIN_PW='...'    # password of admin@example.test
node tests/live/api-matrix.mjs
```

Credentials are never stored in the repository: the owner shares them out of band (see [docs/DEMO.md](../../docs/DEMO.md)).
Browser scripts use Microsoft Edge (`channel: msedge`); set `E2E_CHROMIUM_PATH` to a Chromium/Chrome executable, or
`E2E_BROWSER_CHANNEL=chrome`, to use another browser. They need `npm install` at the repository root (Playwright).
`api-matrix.mjs` imports the built contracts, so run `npm run build` first.

| Script | What it checks | Notes |
| --- | --- | --- |
| `api-matrix.mjs` | All 24 API operations: valid and invalid input, wrong role, cross-author ids, malformed ids, unknown query keys, mass-assignment, concurrency; every response validated against the Zod contracts and scanned for secrets and stack traces | Known, understood behaviours are listed as `KNOWN-ISSUE` and do not fail the run (they print `FIXED` once resolved) |
| `audit-live.mjs` | Ownership, uploads (traversal, disguised types, size, limit), admin queue filters and transitions, headers, CORS, sessions, SSE stream, stored XSS, polling fallback | One check (`IN_PROGRESS -> OPEN rejected`) encodes a wrong assumption: the code allows that transition on purpose (only `CLOSED` is terminal) |
| `closed.mjs` | `CLOSED` is terminal (reopen, reply, attach all 409) and the session cookie lifetime | |
| `ai-live.mjs` | Six categories classify and draft, demo labels, no amounts, nothing auto-sent, admin edits and sends | Requires the demo AI to be enabled; set `FAIL_MODE=stop` after stopping the provider to test failure handling |
| `ai-probe.mjs` | One AI round trip through the public URL (used by recovery tests) | prints one line, exit code 0 on success |
| `ui-journey.mjs` | Author and admin journey in a real browser, including the AI panel | |
| `ui-forms.mjs` | Login validation, protected routes, back/forward, form validation, empty/loading/error states, admin queue filters and pagination | |
| `ux-sweep.mjs` | 5 viewports x every page: horizontal overflow, console errors, failed requests, broken text | screenshots of defects go to the OS temp folder |
| `sse-browser.mjs` | Live-update latency, two sessions, de-duplication, network drop and catch-up, cross-author isolation | |

Login throttling (10 failures per account, 30 per IP, 15 minutes) applies to these scripts too: do not point them at a real account
with wrong passwords.
