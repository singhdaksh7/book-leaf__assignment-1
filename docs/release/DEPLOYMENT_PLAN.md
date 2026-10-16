# Deployment plan (PREPARED, NOT EXECUTED)

Nothing in this document has been run against the VPS. Execution needs the owner's explicit approval. The release SHA is the head of `integration/bookleaf-fullstack` at the time of approval (recorded in the final report; replace `<SHA>` below).

## 1. What changes

| Item | Change |
| --- | --- |
| Services affected | `api` and `web` containers of compose project `bookleaf` only |
| Not touched | `db` container and volumes, Traefik, every other project (printout, vastraa, kp-crm, daxul_labs), Aadya, the host (no reboot, no package updates, no cron changes) |
| Database migrations | **None.** `packages/db` is unchanged since `ba35295`; do **not** run the `migrate` job |
| Behaviour changes | free-model default and guard; reasoning disabled in requests; greeting normalisation; fallback notice; login e-mail trimming; `/login` redirect; "API Mode" text hidden in production builds |
| Environment changes | remove the demo override; set a real `OPENROUTER_API_KEY` in the server's `infra/.env`; `OPENROUTER_MODEL` is optional |
| Expected downtime | a few seconds per container recreate (api, then web) |

## 2. Preconditions (all must be true)

1. Owner approves this plan and the exact SHA.
2. `npm run typecheck`, unit, API and E2E suites pass at `<SHA>` (recorded in the final report).
3. A **fresh pre-deployment backup** exists and decrypts. Today only unencrypted manual dumps exist; run the new `backup.sh` once on the server (needs `BACKUP_PASSPHRASE_FILE`; see `docs/operations/BACKUP_AND_RECOVERY.md`) or take a plain `pg_dump` as the existing runbook does, and copy it **off the server** before continuing.
4. Rollback images are protected (§4).
5. Real-provider decision: which free model to use (Gemma 4 31B was rate-limited upstream during testing; Nemotron 3 Super worked with 3/6 drafts accepted). Without a decision the default model is used and may answer 429, in which case every AI attempt is recorded `FAILED AI_RATE_LIMITED` and tickets continue manually.

## 3. Secret installation (no key in chat, shell history or git)

On the workstation: the key already lives only in `infra/.env` (git-ignored). Copy the single line to the server without printing it:

```bash
# workstation (Git Bash): sends only the OPENROUTER_* lines, never the whole file
grep -E '^OPENROUTER_(API_KEY|MODEL)=' infra/.env | ssh root@77.37.45.177 'umask 077; cat > /opt/bookleaf/src/infra/.env.openrouter'
```

On the server, merge into the existing `infra/.env` (keeping mode 600, never `cat` it):

```bash
cd /opt/bookleaf/src/infra && cp -p .env .env.pre-release   # keeps the previous file for rollback (mode 600)
grep -v -E '^OPENROUTER_(API_KEY|MODEL|BASE_URL)=' .env.pre-release > .env && cat .env.openrouter >> .env && rm .env.openrouter && chmod 600 .env
```

`OPENROUTER_BASE_URL` must be **absent** from `.env` (the default is the real endpoint). Verify without revealing values: `grep -c '^OPENROUTER_API_KEY=.\{8,\}' .env` prints `1`, and `grep '^OPENROUTER_MODEL=' .env` shows a `:free` id.

## 4. Preserve rollback images without touching the host cron

The host job `docker image prune -af --filter until=24h` deletes images that no container uses and that are older than 24 h; tags do not protect them. Two non-invasive protections (neither edits the cron or any other project):

1. **Anchor containers.** Create stopped containers that reference the rollback images, so Docker counts them as in use:
   ```bash
   docker create --name bookleaf-rollback-api-pre-release bookleaf-api:localtest
   docker create --name bookleaf-rollback-web-pre-release bookleaf-web:ee9b387
   ```
   They are named, stopped, have no networks or ports, and are removed by name only (`docker rm bookleaf-rollback-*`).
2. **Offline copies.** `mkdir -p /opt/bookleaf/rollback && docker save bookleaf-api:localtest bookleaf-web:ee9b387 | gzip > /opt/bookleaf/rollback/pre-release-$(date +%Y%m%d).tar.gz`, then copy it off the server. Verify with `gunzip -c ... | docker load --quiet` on another machine or `gzip -t`.

Do the same for the new images after a successful release for the following release.

## 5. Build and ship (workstation, at `<SHA>`)

```bash
git checkout <SHA> && T=$(git rev-parse --short HEAD)
docker build -f infra/docker/api.Dockerfile -t bookleaf-api:$T .
docker build -f infra/docker/web.Dockerfile -t bookleaf-web:$T .
docker save bookleaf-api:$T bookleaf-web:$T | gzip | ssh root@77.37.45.177 'gunzip | docker load'
scp infra/docker-compose.yml infra/docker-compose.demo.yml root@77.37.45.177:/opt/bookleaf/src/infra/   # compose files only; keep the server's .env
```

The server keeps `docker-compose.yml.pre-*` copies already; take one more: `cp -p docker-compose.yml docker-compose.yml.pre-release`.

## 6. Deploy (server, `/opt/bookleaf/src/infra`)

```bash
export T=<short-sha>
docker compose config >/dev/null && echo compose-ok                     # validates interpolation; do not print the output (it contains secrets)
BOOKLEAF_TAG=$T docker compose up -d --no-build --no-deps api         # NO demo override file: this removes the mock
docker compose ps api && docker inspect --format '{{.State.Health.Status}}' bookleaf-api
BOOKLEAF_TAG=$T docker compose up -d --no-build --no-deps web
```

Confirm the mock is gone: `docker exec bookleaf-api sh -c 'echo ${MOCK_AI_ACK:-unset}; echo ${OPENROUTER_BASE_URL:-default}'` must print `unset` and `default`. (Do not print the key.)

## 7. Health checks and smoke tests

1. `curl -s -o /dev/null -w '%{http_code}\n' https://bookleaf.77.37.45.177.sslip.io/healthz` is 200; the site loads over HTTPS.
2. Synthetic accounts only: sign in as an author, create a ticket with a small attachment, sign in as admin, open the ticket, read the analysis. Expected: a real model answer (no `[DEMO MOCK]` text). A `FAILED AI_RATE_LIMITED` result is a provider limit, not a deployment fault; report it, do not switch models silently.
3. Edit the draft and send; check the author sees the reply live and the internal note stays hidden.
4. `tests/live/api-matrix.mjs`, `audit-live.mjs`, `closed.mjs` with the demo passwords (they create synthetic tickets). `ai-live.mjs` and `ai-probe.mjs` assume the demo labels and **will report failures against a real model by design**; use the manual check in step 2 instead.
5. Database persistence: the new ticket survives `docker restart bookleaf-api` (restart only that container).

## 8. Neighbour checks (before and after)

`docker ps --format '{{.Names}} {{.Status}}'` shows the same containers (traefik, printout-*, vastraa-*, kp-*, daxul_labs_*) with unchanged uptime; `df -h /` and `free -m` unchanged apart from two new image layers. Nothing outside project `bookleaf` is restarted or modified.

## 9. Rollback

```bash
cd /opt/bookleaf/src/infra
cp -p .env .env.failed-release && cp -p .env.pre-release .env && chmod 600 .env
cp -p docker-compose.yml.pre-release docker-compose.yml
# previous images
BOOKLEAF_TAG=localtest BOOKLEAF_WEB_TAG=ee9b387 docker compose -f docker-compose.yml -f docker-compose.demo.yml up -d --no-build --no-deps api
BOOKLEAF_TAG=localtest BOOKLEAF_WEB_TAG=ee9b387 docker compose up -d --no-build --no-deps web
```

That restores the previous (demo-mock) staging state. Real-AI failures alone are not a reason to roll back: the portal keeps working with manual replies. Do not restore the database unless data was damaged (no migration is involved).

## 10. Approval requested

Explicit approval to execute §3 to §7 at SHA `<SHA>`, with the model decision from §2.5. The host maintenance items (pending reboot and updates, the prune cron, the missing git checkout, installing the backup cron, choosing off-host storage) are separate decisions and are not part of this release.
