# BookLeaf staging deployment

Isolated Docker Compose project (`bookleaf`) behind the host's existing Traefik. Single origin: Traefik routes
`/api/*` and `/healthz` to the API and everything else to the static web container, so session cookies stay first-party.

| Piece | Detail |
| --- | --- |
| Directory | `/opt/bookleaf` (code in `/opt/bookleaf/src`, runtime env in `/opt/bookleaf/src/infra/.env`, mode 600) |
| Containers | `bookleaf-db` (postgres:16-alpine), `bookleaf-api`, `bookleaf-web` |
| Networks | `bookleaf_internal` (internal-only, DB + API), `bookleaf_edge` (Traefik <-> API/web) |
| Volumes | `bookleaf_bookleaf_pgdata`, `bookleaf_bookleaf_attachments` |
| Host ports | none published; PostgreSQL and the API port are reachable only on Docker networks |
| TLS | Traefik `letsencrypt` resolver (HTTP-01) for `bookleaf.<ip>.sslip.io` |

## First deploy

```bash
cd /opt/bookleaf/src/infra
cp .env.example .env && chmod 600 .env   # fill POSTGRES_PASSWORD, SESSION_SECRET (openssl rand -hex 24/32), seed passwords
docker compose up -d db
docker compose --profile tools run --rm migrate
docker compose --profile tools run --rm seed        # synthetic demo data only
docker compose up -d api web
```

Images may be built on the server (`docker compose build`, use `nice -n 19`) or built elsewhere and loaded:
`docker save bookleaf-api:TAG bookleaf-web:TAG | gzip | ssh root@HOST 'gunzip | docker load'`.

## Update

```bash
cd /opt/bookleaf/src && git fetch && git checkout <tag-or-commit>
cd infra && BOOKLEAF_TAG=<new-tag> docker compose build api web
./scripts/backup.sh                                   # always before a migration
BOOKLEAF_TAG=<new-tag> docker compose --profile tools run --rm migrate
BOOKLEAF_TAG=<new-tag> docker compose up -d api web
```

## Backup and restore

`./scripts/backup.sh` writes `backups/db-<ts>.dump` (pg_dump custom format) and `backups/attachments-<ts>.tgz`.

```bash
# restore database (stop api first so nothing writes)
docker compose stop api
docker exec -i bookleaf-db pg_restore -U bookleaf -d bookleaf --clean --if-exists < backups/db-<ts>.dump
docker run --rm -v bookleaf_bookleaf_attachments:/data -v "$PWD/backups:/in" alpine:3 tar xzf /in/attachments-<ts>.tgz -C /data
docker compose up -d api
```

## Rollback

* Code only: redeploy the previous image tag (`BOOKLEAF_TAG=<old> docker compose up -d api web`).
* Bad migration: restore the pre-migration backup (above), then redeploy the old tag.
* Full removal of BookLeaf only (never touches other projects): `docker compose down` (keeps volumes);
  add `-v` only when you intend to discard BookLeaf data.

## Notes

* AI is off until `OPENROUTER_API_KEY` is set; analyses then record `AI_NOT_CONFIGURED`. Setting a key enables paid calls.
* The confidential dataset is never deployed: it is git-ignored, excluded by `.dockerignore`, and the seed job uses only
  `data/synthetic_seed.json`.
* Rate limiting is in-memory per API process; run a single API replica.
* Frontend-only release: build `bookleaf-web:<tag>`, load it, set `BOOKLEAF_WEB_TAG=<tag>` in `.env`, then
  `docker compose up -d --no-build --no-deps web`. Roll back by setting the previous tag.
