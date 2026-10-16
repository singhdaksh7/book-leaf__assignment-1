# Backup and recovery

**Status (read first).** The scripts below are implemented, were tested locally against disposable containers, and since 2026-10-16 are **installed on the VPS** with a daily cron entry. A first encrypted backup of the live database was taken and **restored into an isolated disposable database with matching row counts** (119 tickets, 25 attachments, 122 AI attempts). The first *scheduled* run (02:30 UTC) has not yet been observed, and **no off-host destination is configured**, so backups are local-only on the same disk (the owner also holds a copy of the first set on a workstation): disaster recovery is incomplete until §5 step 1 and the §6 checklist are done.

Observed on the VPS (read-only inspection, 2026-10-16): `/opt/bookleaf/src/infra/backups/` holds four manually taken, **unencrypted** dump/tar pairs (latest 2026-10-16 03:05 UTC) on the same disk as the data; root has no crontab and there is no backup timer.

## 1. What is backed up

| Data | Source | Method |
| --- | --- | --- |
| PostgreSQL database `bookleaf` | container `bookleaf-db` | `pg_dump --format=custom`, piped through `openssl enc -aes-256-cbc -pbkdf2 -iter 600000`; plaintext never written to disk |
| Attachments | volume `bookleaf_bookleaf_attachments` (mounted read-only) | `tar czf -`, piped through the same encryption |

Not backed up: `infra/.env` (secrets; keep them in the owner's password manager), Docker images, the Traefik configuration (shared, outside this repository).

## 2. Scripts

| Script | Purpose |
| --- | --- |
| `infra/scripts/backup.sh` | Dump, encrypt, verify (decrypt + `pg_restore --list` + `tar t` + SHA-256 manifest), rotate, optional rclone upload, status file, optional failure webhook |
| `infra/scripts/restore-test.sh` | Decrypts the newest (or a named) backup, verifies its checksum and restores it into a **disposable** postgres container (internal network, tmpfs, removed afterwards). Never touches the live database |
| `infra/scripts/bookleaf-backup.cron.example` | Schedule (daily backup 02:30 UTC, weekly restore test Monday 03:30 UTC); installed on the VPS as `/etc/cron.d/bookleaf-backup` on 2026-10-16 |

Configuration is by environment variable: `BACKUP_PASSPHRASE_FILE` (required), `BACKUP_DIR`, `DB_CONTAINER`, `ATTACH_VOLUME`, `BACKUP_REMOTE`, `BACKUP_ALERT_WEBHOOK`, `BACKUP_ALERT_ON_SUCCESS`, `KEEP_DAILY`/`KEEP_WEEKLY`/`KEEP_MONTHLY` (7/4/3). The status of the last run is written to `backups/last-status.json` (`status`, `time`, `message`, `offHost`).

Retention: the newest 7 daily sets; Sunday sets are copied to `weekly/` (newest 4 kept); day-1 sets to `monthly/` (newest 3 kept).

## 3. What was actually tested (local, synthetic data, disposable containers)

| Check | Result |
| --- | --- |
| Backup of a synthetic database (500 + 50 rows) and a volume | passed |
| Restore into a disposable container; row counts match (500, 50) | passed |
| Wrong passphrase | restore fails, exit 1 |
| One byte appended to the encrypted file | `CHECKSUM MISMATCH`, exit 1 |
| Missing/empty passphrase file | backup fails, writes `last-status.json` with `fail`, exit 1 |
| Retention (`KEEP_DAILY=2`, four runs) | two sets kept |
| Bug found and fixed during testing | empty weekly/monthly tier made `ls` fail under `pipefail`, aborting the backup |

Not tested: the rclone upload path (no rclone, no destination), the webhook path against a real endpoint, scheduling, running on the VPS's Linux userland, and large data volumes.

## 4. Encryption and the passphrase

Backups are encrypted with AES-256-CBC (PBKDF2, 600 000 iterations, random salt). `openssl enc` is not authenticated encryption; integrity is provided by the SHA-256 manifest and by `pg_restore --list`/`tar t` during verification. **If the passphrase is lost the backups are unrecoverable.** Keep one copy off the server.

## 5. Owner setup (not done)

1. Choose an off-host destination (any rclone backend, e.g. an S3-compatible bucket in a different provider/region). **This may cost money and needs the owner's decision.** Upload only encrypted files; the script already does so.
2. On the VPS, as root: create the passphrase file outside the repository (`umask 077; openssl rand -base64 48 > /root/.bookleaf-backup-pass`) and copy it to the owner's password manager.
3. Install rclone, run `rclone config`, and set `BACKUP_REMOTE=<remote>:<bucket>/bookleaf`.
4. Copy `bookleaf-backup.cron.example` to `/etc/cron.d/bookleaf-backup` (adjust paths and add `BACKUP_REMOTE`, `BACKUP_ALERT_WEBHOOK`).
5. Run once by hand: `BACKUP_PASSPHRASE_FILE=/root/.bookleaf-backup-pass infra/scripts/backup.sh`, then `restore-test.sh`.

## 6. Acceptance checklist (all must be true before calling backups operational)

- [ ] `backup.sh` succeeds on the VPS and `last-status.json` shows `"offHost": true`.
- [ ] The off-host copy exists and `rclone check` passes.
- [ ] `restore-test.sh` succeeds on a backup that was **downloaded back from off-host**.
- [ ] A scheduled run was observed to execute without manual action.
- [ ] A failure was provoked (e.g. wrong passphrase path) and the alert was received.
- [ ] The passphrase copy is stored off the server.

## 7. Restore procedure (manual, owner-approved only)

Restoring over the live database is destructive. Do not do it without explicit approval and a fresh pre-restore backup.

1. Stop writers: `docker compose stop api web` (project `bookleaf` only).
2. Take a fresh backup (§2) so the current state can be recovered.
3. Decrypt: `openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass file:$BACKUP_PASSPHRASE_FILE < db-<stamp>.dump.enc > /tmp/db.dump`
4. Restore: `docker exec -i bookleaf-db pg_restore -U bookleaf -d bookleaf --clean --if-exists --no-owner < /tmp/db.dump`, then delete `/tmp/db.dump`.
5. Attachments: decrypt the `.tgz.enc` and extract into the attachments volume with a throwaway container (`docker run --rm -v bookleaf_bookleaf_attachments:/data -i alpine:3 tar xzf - -C /data`).
6. Start `api web`, check `/healthz`, log in as a synthetic author and admin, open a ticket with an attachment.

Recovery targets (goals, **not verified guarantees**): RPO ≤ 24 h once the daily schedule runs; RTO ≈ 1–2 h for a single-host rebuild from the repository plus the latest off-host backup.
