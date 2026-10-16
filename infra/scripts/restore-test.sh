#!/usr/bin/env bash
# Restores the newest (or given) encrypted database backup into a DISPOSABLE postgres container on an isolated network and
# checks that the data is readable. Never connects to, or restores over, the live database. Removes only what it created.
#   BACKUP_PASSPHRASE_FILE=... infra/scripts/restore-test.sh [path/to/db-<stamp>.dump.enc]
set -euo pipefail
cd "$(dirname "$0")/.."
BACKUP_DIR=${BACKUP_DIR:-$PWD/backups}
if [ ! -r "${BACKUP_PASSPHRASE_FILE:-}" ]; then echo "BACKUP_PASSPHRASE_FILE unset/unreadable" >&2; exit 1; fi
file=${1:-$(ls -1 "$BACKUP_DIR"/daily/db-*.dump.enc 2>/dev/null | sort | tail -n 1)}
if [ -z "$file" ] || [ ! -f "$file" ]; then echo "no backup found" >&2; exit 1; fi

stamp=$(basename "$file" | sed 's/^db-//; s/\.dump\.enc$//')
sumfile="$(dirname "$file")/SHA256SUMS-$stamp"
if [ -f "$sumfile" ]; then
  ( cd "$(dirname "$file")" && grep -F -- "$(basename "$file")" "$sumfile" | sha256sum -c - ) || { echo "CHECKSUM MISMATCH" >&2; exit 1; }
else
  echo "warning: no checksum file for $stamp" >&2
fi

name="bookleaf-restore-test-$$"; net="$name-net"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; docker network rm "$net" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker network create --internal "$net" >/dev/null
docker run -d --name "$name" --network "$net" -e POSTGRES_PASSWORD=restore-test-only -e POSTGRES_DB=restore_test \
  --tmpfs /var/lib/postgresql/data postgres:16-alpine >/dev/null
for _ in $(seq 1 60); do
  if docker exec "$name" psql -U postgres -d restore_test -Atc "select 1" >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$name" psql -U postgres -d restore_test -Atc "select 1" >/dev/null

openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass "file:$BACKUP_PASSPHRASE_FILE" < "$file" \
  | docker exec -i "$name" pg_restore -U postgres -d restore_test --no-owner --exit-on-error
tables=$(docker exec "$name" psql -U postgres -d restore_test -Atc "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")
echo "restored tables: $tables"
docker exec "$name" psql -U postgres -d restore_test -Atc "select relname || ' rows=' || n_live_tup from pg_stat_user_tables order by relname"
if [ "$tables" -lt 1 ]; then echo "RESTORE TEST FAILED: no tables" >&2; exit 1; fi
echo "RESTORE TEST OK file=$(basename "$file") tables=$tables (disposable container removed)"
