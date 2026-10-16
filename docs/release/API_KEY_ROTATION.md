# OpenRouter key rotation and quota recovery (owner action)

Status on 2026-10-16: the production key is valid and not over any spend limit, but the account's free-model allowance is used up
(`/api/v1/key` reported `free_model_daily_requests` 62 used of 50, 0 remaining; `total_credits` 0). A new key does **not** reset this:
the free-model daily limit is enforced per account, not per key. Live inference is therefore blocked until the daily reset
(00:00 UTC, 2026-10-17) or until the account holds purchased credits. Neither is done by this project; both are the owner's decision.

## What happens meanwhile

Every analysis attempt records `AI_RATE_LIMITED`, shows "AI analysis failed" with the reason, produces no draft, and sends nothing.
The admin replies manually. No key, header or provider text reaches the browser.

## Check the quota (no inference, no cost)

Run on the VPS (the key is read from the server file and never printed):

```sh
cd /opt/bookleaf/src/infra
K=$(grep ^OPENROUTER_API_KEY= .env | cut -d= -f2-)
curl -s -H "Authorization: Bearer $K" https://openrouter.ai/api/v1/key | grep -o '"free_model_daily_requests":{[^}]*}'
```

## Rotate the key (after the owner creates a new one in the OpenRouter dashboard)

1. Create the new key in OpenRouter. Keep a spend limit of 0 unless credits are deliberately purchased.
2. Take a backup first: `BACKUP_PASSPHRASE_FILE=/root/.bookleaf-backup-pass /opt/bookleaf/src/infra/scripts/backup.sh`.
3. Edit the server file without echoing the key (mode must stay 600):
   `cd /opt/bookleaf/src/infra && cp .env .env.bak-$(date +%s) && chmod 600 .env && nano .env` and replace the `OPENROUTER_API_KEY=` value.
   Keep `OPENROUTER_MODEL` a `:free` id: the AI package refuses non-`:free` ids before any request is made.
4. Recreate only the API container: `docker compose up -d --no-deps api` (database, web and other projects are not touched).
5. Verify: `curl -s https://bookleaf.77.37.45.177.sslip.io/healthz`, then create one synthetic ticket as an author and run the analysis as admin.
   The bounded live check is `BL_AUTHOR_PW=... BL_ADMIN_PW=... node tests/live/real-ai-smoke.mjs` (about 12 model calls, synthetic tickets only).
6. Revoke the old key in the OpenRouter dashboard and delete `.env.bak-*` (they contain the old key).

## Rollback

`mv .env.bak-<timestamp> .env && docker compose up -d --no-deps api`. The previous API image `bookleaf-api:12edd72` is also retained.

## Never

Do not paste the key into chat, Git, tickets or logs; do not put it in any `VITE_*` variable (it would ship in the browser bundle).
