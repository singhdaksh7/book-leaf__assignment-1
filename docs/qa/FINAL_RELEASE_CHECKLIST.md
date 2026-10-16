# Final release checklist

`[x]` = verified with fresh evidence in this audit; `[~]` = verified with caveats; `[ ]` = open or needs the owner. Evidence is in the
linked reports. Status date: 2026-10-16, revision `ee9b387` (the frontend release) plus the commit that records its verification.

## 1. Acceptance criteria

- [x] Critical features work end to end (24 operations, 26 features; [matrix](FEATURE_VERIFICATION_MATRIX.md))
- [x] No CRITICAL or HIGH release blocker found ([bugs](BUG_REGISTER.md))
- [x] Required automated tests pass: AI 456, API 227 (0 skipped), web 46, scaffold 9, infra 12, Playwright 30 on Node 22 **and** 24 ([report](END_TO_END_TEST_REPORT.md))
- [x] Author/admin access control and cross-author isolation (139 API checks, UI and SSE checks)
- [x] AI requires human review before sending ([AI report](AI_WORKFLOW_REPORT.md))
- [x] Demo AI recovers after API restart, recreate, outage and mock crash (live x4, isolated x7)
- [x] Database persists across restarts; integrity checks and triggers verified
- [~] Backups: exist, non-empty, restore proven in isolation; **no schedule or off-host copy** (BUG-006)
- [x] HTTPS, redirect, HSTS, CSP; certificate valid to 2027-01-13 (renewal not observed)
- [x] No secrets in the repository or logs
- [~] VPS services healthy; neighbours healthy, except that the Aadya tenant was removed by an unidentified root session (BUG-015)
- [x] Documentation matches implementation: corrected and committed (35 diagrams render, 85 links checked, 0 broken)
- [x] Deployed code matches the approved Git revision: the API is unchanged since the `3b09980` comparison (compiled output identical); the web image `bookleaf-web:ee9b387` was built from the exact pushed commit `ee9b387`
- [x] Reviewer walkthrough succeeds: `ui-journey` 16/16 and `docs/DEMO.md`

## 2. Required before declaring the submission final (owner decisions)

- [x] Approved and done: commits `a21b407`, `15f93d8`, `add8e07`, `ee9b387` pushed; dashboard-count fix deployed frontend-only (section 6)
- [ ] Confirm the Aadya decommission was intentional
- [ ] Decide on backups (schedule, retention, off-host copy)
- [ ] Decide on the host reboot and security upgrades
- [ ] Decide on BUG-003 (migration for `DELETE` triggers) and BUG-001/-002/-012 (small API/contract changes)
- [ ] Reseed or clean staging test data before a demo (about 80 synthetic tickets from testing)

## 3. Reviewer package

- [x] Overview, stack and feature list: `README.md`, [feature matrix](FEATURE_VERIFICATION_MATRIX.md)
- [x] Architecture, ER diagrams, data dictionary, API reference/OpenAPI, security, AI, deployment, data flow, NFR, testing, limitations: [docs/architecture](../architecture/README.md)
- [x] Setup, seed, migrate, test and Docker deployment instructions: `README.md`, `docs/ENVIRONMENT.md`, `docs/TESTING.md`, `infra/DEPLOY.md`, `tests/live/README.md`
- [x] Demo walkthrough and reviewer access: `docs/DEMO.md`
- [~] Screenshots: the responsive sweep saves screenshots only for defects, and none were found, so **no screenshot set exists**; capture them from `ux-sweep`/`ui-journey` if the submission needs images
- [x] Staging URL: https://bookleaf.77.37.45.177.sslip.io
- [x] Repository is private; share by adding the reviewer as a GitHub collaborator, and send the synthetic logins out of band (never in the repository)

## 4. Rollback

Frontend-only release: set `BOOKLEAF_WEB_TAG` to the previous tag and `docker compose up -d --no-build --no-deps web`. Demo AI off: `docker compose -f docker-compose.yml up -d --no-build --no-deps api`. Database: restore a dump in `backups/` with the API stopped. Details: `infra/DEPLOY.md`.

## 5. Verdict

See the final response and [BUG_REGISTER.md](BUG_REGISTER.md): no blocker; one MEDIUM defect fixed only locally (BUG-004) and one MEDIUM operational gap (BUG-006).

## 6. Frontend release (2026-10-16)

| Item | Result |
| --- | --- |
| Commits | `a21b407` fix(web) dashboard counts, `15f93d8` live scripts, `add8e07` architecture docs, `ee9b387` QA reports; this evidence is recorded in the commits that follow |
| Image | `bookleaf-web:ee9b387`, built from the exact pushed commit; previous tag `loginfix-20261015` kept for rollback (`BOOKLEAF_WEB_TAG`) |
| Scope | only `bookleaf-web` was recreated; the API (up 16 h) and database (up 20 h) were not touched; no environment, schema or Traefik change |
| Before the fix (live, 101 unresolved tickets) | dashboard check 1/7: admin showed 50 unresolved / 40 awaiting against 101 / 90; author showed 24 active / 25 total against 68 / 72 |
| After the fix | dashboard check **7/7**; `ui-journey` 16/16; `ux-sweep` 55 combinations clean (incl. 390 and 360 px, console, failed requests); `ui-forms` 21/21 with BUG-005 reported as a known issue; AI workflow 34/34 |
| Platform | HTTPS and HSTS/CSP unchanged, certificate valid to 2027-01-13; 0 restarts; 119 tickets, 25 attachments (25 files) and 5 migrations intact; no nginx or API errors, no crashes, no secrets in logs; the 13 neighbouring containers identical to the pre-release snapshot |
| Rollback | not needed. Command: set `BOOKLEAF_WEB_TAG=loginfix-20261015` and `docker compose -f docker-compose.yml -f docker-compose.demo.yml up -d --no-build --no-deps web` |
