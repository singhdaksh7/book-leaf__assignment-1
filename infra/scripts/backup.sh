#!/usr/bin/env bash
# BookLeaf backup: PostgreSQL dump + attachments volume -> encrypted, checksummed, verified, rotated, optionally copied off-host.
# Touches only the bookleaf-* containers/volumes. Never deletes anything outside BACKUP_DIR. See docs/operations/BACKUP_AND_RECOVERY.md.
#
# Required:  BACKUP_PASSPHRASE_FILE  file (chmod 600, outside the repo) holding the encryption passphrase.
# Optional:  BACKUP_DIR (default ./backups)  DB_CONTAINER (bookleaf-db)  ATTACH_VOLUME (bookleaf_bookleaf_attachments)
#            BACKUP_REMOTE   rclone destination such as "offsite:bookleaf" (needs rclone configured; unset = NOT off-host)
#            BACKUP_ALERT_WEBHOOK  URL that receives a JSON POST on failure (and on success if BACKUP_ALERT_ON_SUCCESS=1)
#            KEEP_DAILY=7 KEEP_WEEKLY=4 KEEP_MONTHLY=3
set -euo pipefail
cd "$(dirname "$0")/.."

BACKUP_DIR=${BACKUP_DIR:-$PWD/backups}
DB_CONTAINER=${DB_CONTAINER:-bookleaf-db}
ATTACH_VOLUME=${ATTACH_VOLUME:-bookleaf_bookleaf_attachments}
KEEP_DAILY=${KEEP_DAILY:-7}; KEEP_WEEKLY=${KEEP_WEEKLY:-4}; KEEP_MONTHLY=${KEEP_MONTHLY:-3}
stamp=$(date -u +%Y%m%dT%H%M%SZ)
status_file="$BACKUP_DIR/last-status.json"
OFFHOST=false
tmp=""
done_ok=0

notify() { # $1=ok|fail $2=message
  mkdir -p "$BACKUP_DIR"
  printf '{"status":"%s","time":"%s","message":"%s","offHost":%s}\n' "$1" "$stamp" "$2" "$OFFHOST" > "$status_file"
  if [ -n "${BACKUP_ALERT_WEBHOOK:-}" ] && { [ "$1" = fail ] || [ "${BACKUP_ALERT_ON_SUCCESS:-0}" = 1 ]; }; then
    curl -fsS -m 15 -X POST -H 'content-type: application/json' --data "@$status_file" "$BACKUP_ALERT_WEBHOOK" >/dev/null || echo "warning: alert webhook failed" >&2
  fi
}
fail() { echo "BACKUP FAILED: $*" >&2; notify fail "$*"; done_ok=2; exit 1; }
cleanup() {
  rc=$?
  if [ "$rc" -ne 0 ] && [ "$done_ok" -ne 2 ]; then notify fail "unexpected error (exit $rc)"; fi
  if [ -n "$tmp" ] && [ -d "$tmp" ]; then rm -rf -- "$tmp"; fi
  exit "$rc"
}
trap cleanup EXIT

if [ -z "${BACKUP_PASSPHRASE_FILE:-}" ] || [ ! -s "$BACKUP_PASSPHRASE_FILE" ]; then fail "BACKUP_PASSPHRASE_FILE is unset, unreadable or empty"; fi
mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly" "$BACKUP_DIR/monthly"; chmod 700 "$BACKUP_DIR"
tmp=$(mktemp -d "$BACKUP_DIR/.tmp.XXXXXX")

enc() { openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass "file:$BACKUP_PASSPHRASE_FILE"; }
dec() { openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass "file:$BACKUP_PASSPHRASE_FILE"; }

# 1. Database (custom format, compressed) is encrypted in a pipe, so plaintext never lands on disk.
db_out="$BACKUP_DIR/daily/db-$stamp.dump.enc"
docker exec "$DB_CONTAINER" pg_dump -U bookleaf -d bookleaf --format=custom | enc > "$tmp/db.enc" || fail "pg_dump or encryption failed"
mv "$tmp/db.enc" "$db_out"

# 2. Attachments volume (mounted read-only).
att_out="$BACKUP_DIR/daily/attachments-$stamp.tgz.enc"
docker run --rm -v "$ATTACH_VOLUME":/data:ro alpine:3 tar czf - -C /data . | enc > "$tmp/att.enc" || fail "attachment archive or encryption failed"
mv "$tmp/att.enc" "$att_out"

# 3. Integrity: decrypt and structurally check both artefacts, then checksum the ciphertext.
dec < "$db_out" | docker run --rm -i postgres:16-alpine pg_restore --list >/dev/null || fail "database dump failed verification (pg_restore --list)"
dec < "$att_out" | tar tzf - >/dev/null || fail "attachment archive failed verification (tar t)"
[ "$(wc -c < "$db_out")" -gt 1024 ] || fail "database dump suspiciously small"
( cd "$BACKUP_DIR/daily" && sha256sum "db-$stamp.dump.enc" "attachments-$stamp.tgz.enc" > "SHA256SUMS-$stamp" ) || fail "checksum failed"

# 4. Promote copies for weekly (Sunday) and monthly (day 1) retention.
if [ "$(date -u +%u)" = 7 ]; then cp "$db_out" "$att_out" "$BACKUP_DIR/daily/SHA256SUMS-$stamp" "$BACKUP_DIR/weekly/"; fi
if [ "$(date -u +%d)" = 01 ]; then cp "$db_out" "$att_out" "$BACKUP_DIR/daily/SHA256SUMS-$stamp" "$BACKUP_DIR/monthly/"; fi

# 5. Retention: keep the newest N sets per tier (a set is identified by its timestamp).
prune() { # $1=dir $2=keep
  { ls -1 "$1"/db-*.dump.enc 2>/dev/null || true; } | sort -r | tail -n +"$(( $2 + 1 ))" | while read -r f; do
    ts=${f##*/db-}; ts=${ts%.dump.enc}
    rm -f -- "$1/db-$ts.dump.enc" "$1/attachments-$ts.tgz.enc" "$1/SHA256SUMS-$ts"
  done
}
prune "$BACKUP_DIR/daily" "$KEEP_DAILY"; prune "$BACKUP_DIR/weekly" "$KEEP_WEEKLY"; prune "$BACKUP_DIR/monthly" "$KEEP_MONTHLY"

# 6. Off-host copy (optional). Only encrypted files are uploaded. Without BACKUP_REMOTE this is reported as NOT off-host.
if [ -n "${BACKUP_REMOTE:-}" ]; then
  command -v rclone >/dev/null || fail "BACKUP_REMOTE is set but rclone is not installed"
  rclone copy --checksum --include '*.enc' --include 'SHA256SUMS-*' "$BACKUP_DIR" "$BACKUP_REMOTE" || fail "off-host upload failed"
  rclone check --one-way --include '*.enc' "$BACKUP_DIR" "$BACKUP_REMOTE" >/dev/null 2>&1 || fail "off-host verification failed"
  OFFHOST=true
else
  echo "WARNING: BACKUP_REMOTE not set; backups exist only on this host." >&2
fi

done_ok=1
notify ok "backup $stamp verified"
ls -l "$db_out" "$att_out"
echo "BACKUP OK stamp=$stamp offHost=$OFFHOST"
