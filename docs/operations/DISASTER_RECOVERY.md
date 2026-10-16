# Disaster recovery

Targets below are planning goals, not measured or verified guarantees. See [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md) for what exists today (scripts installed and scheduled on the VPS; restore proven in isolation; **no off-host copy**).

## Scenarios

| Scenario | Impact | Recovery |
| --- | --- | --- |
| API container fails | Portal API down, data intact | `docker compose up -d api` in project `bookleaf`; if a release caused it, redeploy the previous image tag (see rollback in `infra/DEPLOY.md`) |
| Bad release | Regression | Re-tag/deploy the previous `bookleaf-api`/`bookleaf-web` image. **Rollback images must exist**: see the image-prune risk below |
| Database corruption or accidental deletion | Data loss up to the last backup | Restore the newest verified backup (BACKUP_AND_RECOVERY §7). With the daily cron the loss window is up to 24 h once scheduled runs are observed to succeed |
| Attachment volume lost | Files missing, rows intact | Restore the attachments archive from the same backup set |
| VPS lost or unrecoverable | Total outage | New host, install Docker and the shared Traefik, clone the repository at the released SHA, recreate `infra/.env` from the password manager, `docker compose up -d`, restore DB and attachments from **off-host** backup. Only partly possible today: no automated off-host copy exists (one manual encrypted copy of the 2026-10-16 backup is on the owner workstation) |
| Secret leaked (`SESSION_SECRET`, DB password, OpenRouter key) | Compromise | Rotate the secret in `infra/.env`; changing `SESSION_SECRET` invalidates CSRF tokens (sessions are DB rows: delete `Session` rows to force logout); revoke the OpenRouter key in its dashboard |
| OpenRouter free quota exhausted or provider down | AI attempts record `FAILED` with an error code; ticket handling continues manually | Wait for the daily reset or add a different **free** model via `OPENROUTER_MODEL`; nothing falls back to the mock or to a paid model |

## Known risks found during read-only inspection (2026-10-16)

1. **Automatic image pruning can delete rollback images.** `/etc/cron.d/docker-image-prune` runs `docker image prune -af --filter "until=24h"` daily. It removes every image not used by a container and older than 24 h, which includes BookLeaf rollback tags such as `bookleaf-api:pre-mockai` and `bookleaf-web:loginfix-20261015` once they age. **Mitigation applied 2026-10-16 without touching the cron:** four stopped, labelled anchor containers (`bookleaf-rollback-*`) reference the four BookLeaf images, so Docker counts them as in use, and an offline tarball is kept in `/opt/bookleaf/rollback/` and on the owner workstation. Anchors must be recreated for each new release's rollback images.
2. **Pending host reboot** (`/var/run/reboot-required` exists) and pending security updates, as reported earlier. Host maintenance is outside this release.
3. **Single host, single disk**: the database, attachments and local backups share a disk.
4. **The deployed source tree is not a git checkout** (`/opt/bookleaf/src` has no `.git`); the running API image is tagged `localtest` and the web image `ee9b387`. The deployed revision therefore cannot be proven equal to any GitHub commit.

## Periodic drill (once backups are operational)

Monthly: run `restore-test.sh` against a backup fetched from off-host; record date, backup stamp, duration and table/row counts in the operations log. Quarterly: rehearse a full rebuild on a scratch host.
