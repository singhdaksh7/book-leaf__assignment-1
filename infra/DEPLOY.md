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

## Optional demonstration AI (staging only, opt-in)

`infra/mock-ai/server.mjs` stands in for OpenRouter so the real `@bookleaf/ai` pipeline (validation, grounding, admin review
UI) can be demonstrated without a paid provider. It performs no AI: it keyword-matches the ticket and returns canned,
policy-grounded text, labelled `[DEMO MOCK ...]` in the admin-visible rationale and `[DEMO DRAFT ...]` at the top of the draft.
It refuses to start without `MOCK_AI_ACK=demonstration-only`, runs as a non-root user on a read-only filesystem and is not part
of the default service set. The AI package accepts plain `http` only for `127.0.0.1`/`localhost`, so the mock shares the API
container's network namespace (`network_mode: service:api`) and listens on loopback there: it has no network, IP address or
published port of its own and only the API can reach it. Never enable it for a real deployment: leave `OPENROUTER_BASE_URL`
at its default and the key empty so analyses record `AI_NOT_CONFIGURED` instead of fabricated output.

How AI runs in each setting:

| Setting | Provider | Output |
| --- | --- | --- |
| Production | OpenRouter (`OPENROUTER_API_KEY` set; paid) | Real model inference, validated by the grounding checks |
| Automated tests | Local mock HTTP servers inside the test suites | Scripted responses; no network, no cost |
| Opt-in staging demo (this section) | `infra/mock-ai` | Canned keyword-matched text labelled `[DEMO MOCK]` / `[DEMO DRAFT]`; **not** AI inference |

```bash
# in .env:  OPENROUTER_BASE_URL=http://127.0.0.1:8080/api/v1  OPENROUTER_API_KEY=demo-not-a-real-key  OPENROUTER_MODEL=demo/mock-not-a-real-model
docker compose --profile demo up -d --no-build --no-deps api mock-ai   # recreates only the API, then starts the mock beside it
# turn off: remove those three lines from .env, then
docker compose --profile demo rm -sf mock-ai && docker compose up -d --no-build --no-deps api
```
