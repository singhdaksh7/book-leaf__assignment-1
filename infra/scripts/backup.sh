#!/usr/bin/env bash
# Backs up the BookLeaf database and attachments to ./backups (run on the server from the deployment directory).
# Only touches the bookleaf-* containers and volumes.
set -euo pipefail
cd "$(dirname "$0")/.."
stamp=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p backups && chmod 700 backups
docker exec bookleaf-db pg_dump -U bookleaf -d bookleaf --format=custom > "backups/db-$stamp.dump"
docker run --rm -v bookleaf_bookleaf_attachments:/data:ro -v "$PWD/backups:/out" alpine:3 tar czf "/out/attachments-$stamp.tgz" -C /data .
ls -l "backups/db-$stamp.dump" "backups/attachments-$stamp.tgz"
