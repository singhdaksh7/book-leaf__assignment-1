# Production synthetic-data inventory (read-only, 2026-10-16, after the dataset import)

Nothing was deleted or modified to produce this. Counts come from SELECT queries on the live database through the BookLeaf DB container.
A fresh encrypted backup (`20261016T095733Z`) was taken first and restored successfully in an isolated container.

| Item | Count | Notes |
| --- | --- | --- |
| Users | 24 | 1 admin, 10 original authors (`@email.com`, from the assignment dataset), 13 synthetic authors (`@example.test`) |
| Author profiles / books | 23 / 36 | 10 + 18 are the assignment's `AUTH001-010` / `BK001-018`; 13 + 18 are synthetic |
| Tickets | 169 | 157 with no prefix (API/UI test runs), 6 `[LIVE-CHECK]`, 6 `[REAL-AI SMOKE]`; statuses OPEN 143, IN_PROGRESS 19, CLOSED 7 |
| Tickets on the original authors | 0 | Reviewers who log in as `AUTH001-010` start with an empty ticket history |
| AI analyses | 266 | 118 COMPLETED (mock era and earlier real/mocked runs), 148 FAILED (quota and earlier tests) |
| Attachments | 50 rows, 50 files on the volume | all belong to synthetic tickets |
| Audit rows / sessions | 269 / 92 | audit history is preserved |

## Reviewer impact

The admin queue is dominated by synthetic tickets (169), which can hide the fact that the assignment dataset is present. Reviewers are told to
look at the author side first (`AUTH001-010` with `BK001-018`) and to create their own ticket; the admin queue can be filtered by status and category.

## Cleanup

Not executed (no approval). The tested tool and the plan are in `SYNTHETIC_CLEANUP_PLAN_V2.md`: it requires a verified backup, a dry run, a
confirmation token and keeps the admin, the ten original authors and the audit log. Cleanup is not a submission blocker.
