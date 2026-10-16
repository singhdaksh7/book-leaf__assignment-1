# BookLeaf staging deployment

Isolated Docker Compose project (`bookleaf`) behind the host's existing Traefik. Single origin: Traefik routes
`/api/*` and `/healthz` to the API and everything else to the static web container, so session cookies stay first-party.

| Piece | Detail |
| --- | --- |
| Directory | `/opt/bookleaf/src/infra` holds only the deployment files (compose files, Dockerfiles for reference, `mock-ai`, scripts) and the runtime `.env` (mode 600). The application source is **not** on the server and there is no git checkout there: images are built from a commit on a workstation and loaded (see Update). |
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
# Do NOT seed a production stack: the synthetic seed is refused when NODE_ENV=production (the image default).
# Create the single admin instead (credentials from the environment, never on the command line):
#   docker compose run --rm -e BOOKLEAF_ADMIN_EMAIL -e BOOKLEAF_ADMIN_PASSWORD -w /repo api npm run admin:ensure --workspace @bookleaf/db
# Authors register themselves at /register.
docker compose up -d api web
```

Images may be built on the server (`docker compose build`, use `nice -n 19`) or built elsewhere and loaded:
`docker save bookleaf-api:TAG bookleaf-web:TAG | gzip | ssh root@HOST 'gunzip | docker load'`.

## Update

```bash
# On your workstation, at the commit to release (tag images with the short SHA so a running image can be traced to its commit):
#   git checkout <commit> && T=$(git rev-parse --short HEAD)
#   docker build -f infra/docker/api.Dockerfile -t bookleaf-api:$T . && docker build -f infra/docker/web.Dockerfile -t bookleaf-web:$T .
#   docker save bookleaf-api:$T bookleaf-web:$T | gzip | ssh root@HOST 'gunzip | docker load'
#   scp infra/docker-compose.yml infra/docker-compose.demo.yml root@HOST:/opt/bookleaf/src/infra/ && scp -r infra/mock-ai root@HOST:/opt/bookleaf/src/infra/
# On the server (set BOOKLEAF_TAG / BOOKLEAF_WEB_TAG in .env or inline):
cd /opt/bookleaf/src/infra
./scripts/backup.sh                                   # always before a migration
BOOKLEAF_TAG=<new-tag> docker compose --profile tools run --rm migrate
BOOKLEAF_TAG=<new-tag> docker compose up -d api web
```

## Production data hygiene

* **Public registration** (`POST /auth/register`) is on by default and rate limited (`REGISTER_LIMIT_PER_IP_PER_HOUR` 5, `REGISTER_LIMIT_GLOBAL_PER_HOUR` 200). Behind Traefik set `TRUST_PROXY=1`, otherwise every client shares one IP and the per-IP allowance is shared too.
* **The synthetic seed** (`docker compose --profile tools run --rm seed`) now refuses to run with `NODE_ENV=production` unless `BOOKLEAF_ALLOW_SYNTHETIC_SEED=yes-i-understand` is set. Use it only for a deliberate demo or staging stack.
* **Removing synthetic records from a database**: [`docs/release/REGISTRATION_RELEASE_PLAN.md`](../docs/release/REGISTRATION_RELEASE_PLAN.md) section 7 (backup, dry run, owner approval, execute with a token). Never run it without a verified backup.
* **Admin account**: [`docs/release/ADMIN_ACCOUNT.md`](../docs/release/ADMIN_ACCOUNT.md).
* This release needs **no migration** (`migrate` is a no-op).

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

How AI runs in each setting:

| Setting | Provider | Output |
| --- | --- | --- |
| Production | OpenRouter (`OPENROUTER_API_KEY` set; paid) | Real model inference, validated by the grounding checks |
| Automated tests | Local mock HTTP servers inside the test suites | Scripted responses; no network, no cost |
| Opt-in staging demo (this section) | `infra/mock-ai` | Canned keyword-matched text labelled `[DEMO MOCK]` / `[DEMO DRAFT]`; **not** AI inference |

**How it is wired, and why.** The AI package accepts plain `http` only for `127.0.0.1`/`localhost`, so the API must reach the mock
on loopback. `docker-compose.demo.yml` therefore runs the mock as a supervised background process **inside the API container**
(`while true; do node /mock-ai/server.mjs; sleep 2; done & exec node dist/server.js`, API stays PID 1). It listens on `127.0.0.1:8080`
only, so it has no container, address or published port of its own. It refuses to start without `MOCK_AI_ACK=demonstration-only`.
The override sets the dummy key, model and loopback URL itself (not `.env`), so the demo cannot be half-enabled and a real key can
never be combined with the mock.

An earlier design ran the mock as a separate container sharing the API's network namespace (`network_mode: service:api`). It was
abandoned after live and local testing: the mock is pinned to the API container's id and namespace, so a `docker restart` strands
it in the old namespace and a **recreate** (`up --force-recreate`, `--no-deps`, or an image/env change) leaves it permanently unable
to start, with neither a watchdog nor `depends_on: restart: true` able to repair it. Living inside the API container removes the
coupling: whatever restarts, recreates or crash-restarts the API brings the mock with it, and a crash of the mock alone is retried
after 2 s. Trade-off: the mock shares the API container's user, memory limit and (writable) filesystem; it mounts its code read-only.

```bash
# enable (recreates only the API; the demo settings come from the override file, nothing to edit in .env)
docker compose -f docker-compose.yml -f docker-compose.demo.yml up -d --no-build --no-deps api
# disable (recreates only the API with the normal configuration; use the .env values for a real deployment)
docker compose -f docker-compose.yml up -d --no-build --no-deps api
```

Use the same `-f` pair for every later command that touches the API while the demo is enabled, otherwise Compose recreates the API
without the mock and AI attempts record `AI_NOT_CONFIGURED`/`AI_NETWORK_ERROR`. Never enable it for a real deployment.
Logs from the mock appear in `docker logs bookleaf-api` (method, path, status and category only; never prompt text).
