# Final release checklist

`[x]` = verified with fresh evidence in this audit; `[~]` = verified with caveats; `[ ]` = open or needs the owner. Evidence is in the
linked reports. Status date: 2026-10-16, revision `88cad7a` plus **uncommitted local changes** (see section 6).

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
- [~] Documentation matches implementation: corrected locally (35 diagrams render, 82+ links checked), not yet committed
- [~] Deployed code matches the approved Git revision: compiled output identical to a clean build of `3b09980`, **not re-verified** after the local changes, which are not deployed
- [x] Reviewer walkthrough succeeds: `ui-journey` 16/16 and `docs/DEMO.md`

## 2. Required before declaring the submission final (owner decisions)

- [ ] Approve committing the local changes (section 6) and pushing the branch
- [ ] Decide whether to deploy the dashboard-count fix (needs a web image rebuild and a frontend-only release)
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

## 6. Local, uncommitted changes (nothing pushed or deployed this round)

| Change | Files |
| --- | --- |
| Dashboard count fix + regression tests | `apps/web/src/pages/admin/AdminDashboardPage.tsx`, `apps/web/src/pages/author/DashboardPage.tsx`, `apps/web/src/test/dashboard-counts.test.tsx` |
| Live test scripts | `tests/live/*` (9 scripts + README) |
| Architecture docs (previously untracked, from another process) with corrections and 6 new files | `docs/architecture/**` |
| QA reports | `docs/qa/*` |
| Documentation corrections | `README.md`, `docs/ENVIRONMENT.md`, `docs/KNOWN_LIMITATIONS.md` |
