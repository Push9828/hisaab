# @hisaab/adapter

Telegram webhook adapter. Production runs on AWS Lambda behind API Gateway (M4). For development it
can still run on your laptop behind a tunnel (M3).

```
Production: Phone -> Telegram -> API Gateway (POST /) -> lambda.ts  -> handleWebhook -> core.ingest -> Supabase (Mumbai)
Local:      Phone -> Telegram -> tunnel -> local.ts (127.0.0.1:8787) -> handleWebhook -> core.ingest -> local Postgres
                                          reply <- { method: 'sendMessage', ... } (the response body)
```

There is one bot, so the webhook points at one of these at a time. `webhook:set` with a tunnel URL
takes the bot away from production until you run `webhook:set:prod` again.

`handleWebhook` (`src/telegram.ts`) checks the secret header, then the message shape, then the
sender. Anything it does not handle gets a silent 200. Logs are a startup line plus fixed labels
(`unauthorized`, `ignored`, `processed`, `duplicate`, `error`, `bad_request`, `llm_guessed`, `llm_unsure`,
`llm_failed`, and `aborted` locally), never
message text, balances or errors. The local server checks the secret before reading the body,
and cuts off slow senders (5s headers, 10s request).

Telegram is told to use one connection (`max_connections: 1`), so messages are processed in
the order you sent them. Forwarded messages and inline-bot messages are ignored.

## The `tg` helper

Calls the Bot API from the repo root without the token touching your shell, its history or the
process list (`printf` is a builtin, and curl reads the URL from stdin):

```bash
tg() ( set -a; . apps/adapter/.env; printf 'url = "https://api.telegram.org/bot%s/%s"\n' "$TELEGRAM_BOT_TOKEN" "$1" | curl -s -K - )
```

## One-time setup

1. **Bot.** In Telegram, message `@BotFather`, send `/newbot`, then choose a display name and a
   username ending in `bot`. Avoid your name or anything finance-related in the username: it is
   public. Optional: `/setjoingroups` -> Disable.
2. **Env.** Copy `.env.example` to `.env` and `chmod 600 .env`. Fill in:
   - `TELEGRAM_BOT_TOKEN`: from BotFather. Paste it straight into the file.
   - `TELEGRAM_WEBHOOK_SECRET`: `openssl rand -hex 32` (at least 32 characters are required).
   - `DATABASE_URL`: the same value as in `packages/db/.env`.
   - `TELEGRAM_ALLOWED_USER_ID`: message your bot once, then, before any webhook is set, run
     `tg getUpdates | grep -o '"from":{"id":[0-9]*'` (the `tg` helper is below). An empty
     `result` means the bot has not received a message yet. `tg getMe` shows which bot the token
     belongs to. `getUpdates` does not work while a webhook is set.
3. **Database.** `pnpm --filter @hisaab/db db:up`, then `pnpm db:migrate`.
4. **Tunnel.** `brew install cloudflared`.

## Run (three terminals, from the repo root)

```bash
pnpm --filter @hisaab/adapter dev                          # 1. server on 127.0.0.1:8787
cloudflared tunnel --protocol http2 --url http://127.0.0.1:8787   # 2. prints https://<random>.trycloudflare.com
pnpm --filter @hisaab/adapter webhook:set https://<random>.trycloudflare.com   # 3. register it
```

Quick tunnels get a new URL on every restart, so rerun step 3 after each one. Messages sent
while the server was down are delivered once the webhook points at a live URL again, as long
as that is within 24 hours (Telegram drops older pending updates).

**No reply?** Ask Telegram what went wrong (this never prints the token):

```bash
pnpm --filter @hisaab/adapter webhook:info
```

**cloudflared says "critical failures" / QUIC and TCP 7844 blocked:** check that a VPN (for
example ProtonVPN with its kill switch) is fully off or split-tunnels `cloudflared`. The
`--protocol http2` flag avoids the UDP path. If it still fails, `ngrok http 8787` works over
port 443 and needs no code changes.

## End-to-end checklist (fake aliases)

Run this with made-up aliases so the real ledger stays clean. Send the messages in order and check
`accounts` after each step.

```
open tbank 84200 bank
open tbankcc 1500 cc
open tbom 50000 bank
open tsam 0 receivable
open tana 0 receivable
```

| SPEC 5 | Send | Expect (`accounts`) |
|---|---|---|
| 1 | `petrol 4k cc tbank` | TBANKCC -5,500; TBANK unchanged |
| 2 | `pay tbankcc 4k from tbank` | TBANK 80,200; TBANKCC -1,500 |
| 3 | `xfer 25k tbank tbom` | TBANK 55,200; TBOM 75,000 |
| 4 | `emi 32k tbom` | TBOM 43,000 |
| 5 | `lend tsam 10k tbank`, `got tsam 5k tbank` | TBANK 50,200; TSAM 5,000 |
| 6 | `dinner 4000 split tsam 1000 tana 1000 cc tbank` | TBANKCC -5,500; TSAM 6,000; TANA 1,000 |
| 7 | `in 85k salary tbank` | TBANK 1,35,200 |
| 8 | `bal tbank 136000` | reply shows +800; TBANK 1,36,000 |

Then:
- `undo` voids the adjustment, so TBANK is back to 1,35,200.
- `petrol 4k` gets a clarifying question and writes nothing.
- An edited message produces no reply.
- A message from another Telegram account produces no reply, and the server logs `ignored`.
- Forward any message to the bot: no reply, and the server logs `ignored`.
- Terminal 1 shows only the startup line, timestamps and labels.

## Before real use

Wipe the test rows. Accounts cannot be undone, so drop the dev database. **Run this once, before
the first real message:** it deletes everything in the volume, real entries and the test database included.

```bash
pnpm --filter @hisaab/db db:down -v && pnpm --filter @hisaab/db db:up && pnpm db:migrate
```

## Production (AWS)

Lambda (`nodejs22.x`, arm64) behind an HTTP API in `ap-south-1`, deployed with SAM (`template.yaml`,
`samconfig.toml`). At cold start it reads one JSON secret, `hisaab/webhook`, from Secrets Manager:
`TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ALLOWED_USER_ID`, `DATABASE_URL`, and optionally `SARVAM_API_KEY`. The bot token is not in it;
replies go back in the response body, so only the laptop needs the token. Logs are kept 14 days.

Prod files on the laptop (gitignored, `chmod 600`):
- `apps/adapter/.env.production`: `TELEGRAM_BOT_TOKEN`, the **prod** `TELEGRAM_WEBHOOK_SECRET`,
  `TELEGRAM_ALLOWED_USER_ID`, and optionally `SARVAM_API_KEY`. `webhook:set:prod` reads the first three; "Push the secret" reads all but the token.
- `packages/db/.env.production`: `DATABASE_URL`, Supabase's **Session pooler** URI (port 5432), with no
  `?sslmode`. TLS is verified in code against Supabase's CA. Read by `db:migrate:prod`.

All commands below run from the repo root, after `aws sso login --profile hisaab`.

### Deploy or redeploy

```bash
pnpm --filter @hisaab/db db:migrate:prod          # first, if the change adds a migration
pnpm --filter @hisaab/adapter deploy:aws          # esbuild bundle + sam deploy (confirm the changeset)
```

A failed deploy rolls back by itself. To go back to an earlier version, check out its commit and
deploy again. Migrations are never run by a deploy, and a rollback does not undo one, so keep
migrations backward compatible with the previous code.

The webhook URL, needed only when the API is recreated:

```bash
aws cloudformation describe-stacks --stack-name hisaab --profile hisaab --region ap-south-1 \
  --query "Stacks[0].Outputs[?OutputKey=='WebhookUrl'].OutputValue" --output text
pnpm --filter @hisaab/adapter webhook:set:prod <WebhookUrl>
```

### Check it

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST <WebhookUrl> -d '{}'   # 401: no secret header
pnpm --filter @hisaab/adapter webhook:info                              # no last_error_message
aws logs tail /aws/lambda/hisaab-webhook --since 15m --profile hisaab --region ap-south-1
```

Logs must show only the runtime's `INIT_START` (cold starts), `START`, `END` and `REPORT` lines, and
labels (`processed`, `unauthorized`, ...), each prefixed with a timestamp, request id and `INFO`. A
`500` from the curl means the Lambda could not read its secret or it is malformed.

### Change a value in the secret (webhook secret, database password)

The laptop's `.env.production` files are the source of truth; the secret is rebuilt from them. The
Lambda caches the secret until its next cold start, so each change ends by forcing one.

Two shared steps, referred to below:

- **Push the secret.** Builds the JSON from the two files and pipes it to AWS, so no value is
  written to disk, typed, or shown in the process list:
  ```bash
  node -e '
    const { parseEnv } = require("node:util"), { readFileSync: read } = require("node:fs");
    const a = parseEnv(read("apps/adapter/.env.production", "utf8"));
    const d = parseEnv(read("packages/db/.env.production", "utf8"));
    process.stdout.write(JSON.stringify({ TELEGRAM_WEBHOOK_SECRET: a.TELEGRAM_WEBHOOK_SECRET,
      TELEGRAM_ALLOWED_USER_ID: a.TELEGRAM_ALLOWED_USER_ID, DATABASE_URL: d.DATABASE_URL,
      SARVAM_API_KEY: a.SARVAM_API_KEY }));' |
  aws secretsmanager put-secret-value --secret-id hisaab/webhook --secret-string file:///dev/stdin \
    --profile hisaab --region ap-south-1 --query VersionId --output text
  ```
- **Force a cold start.** Changing an environment variable replaces the running environments.
  `--environment` replaces all variables, so `SECRET_ID` must be repeated. The next `sam deploy`
  removes `ROTATED` again, which is harmless.
  ```bash
  aws lambda update-function-configuration --function-name hisaab-webhook --profile hisaab \
    --region ap-south-1 --environment "Variables={SECRET_ID=hisaab/webhook,ROTATED=$(date +%s)}" >/dev/null
  ```

**New webhook secret:**
1. Put a new `TELEGRAM_WEBHOOK_SECRET` (`openssl rand -hex 32`) in `apps/adapter/.env.production`.
2. Push the secret, then force a cold start.
3. `pnpm --filter @hisaab/adapter webhook:set:prod <WebhookUrl>`.

Deliveries between steps 2 and 3 get 401, and Telegram retries them. Nothing is lost.

**New database password:**
1. Reset it in Supabase (Project Settings > Database). Use letters and digits only, or
   percent-encode it in the URL.
2. Put it in `packages/db/.env.production`, then run `pnpm --filter @hisaab/db db:migrate:prod` as
   a connection check. It should print `migrations applied (hosted, TLS verified)`.
3. Push the secret, then force a cold start, straight away.
4. Send `accounts` from the phone.

Messages sent between steps 1 and 3 get the "Something went wrong" reply. That is a 200, so
Telegram does not retry them: resend them once `accounts` works.

### Category fallback (Sarvam)

With `SARVAM_API_KEY` in the secret, a keyword miss goes to Sarvam for a guess; without it the bot uses keyword rules only.
There is no migration, and the code is safe to deploy before the key exists.

**Switch it on:**
1. `pnpm --filter @hisaab/adapter deploy:aws`. Send a keyword entry (`petrol 100 <bank>`), then `undo`.
2. Put `SARVAM_API_KEY` in `apps/adapter/.env.production`.
3. Push the secret, then force a cold start.
4. Send a fake-description entry (`asdfchai 100 <bank>`), then `undo`. The reply says `guessed` or `category needs review`.
5. `aws logs tail` as above: only labels, such as `llm_guessed`, then `processed`.

**Switch it off:** remove the key from the file, push the secret, then force a cold start. Earlier entries are unchanged.

Guessed rows are the ones with `status = 'NEEDS_REVIEW' AND category IS NOT NULL`.

### Rotate the bot token

In `@BotFather`, `/revoke`, then put the new token in both `apps/adapter/.env` and
`apps/adapter/.env.production`, and run `webhook:set:prod`. The Lambda never has the token, so
nothing in AWS changes.

### Local development while production is live

Production data is on Supabase and local data is in Docker; they are never mixed. Pointing the bot
at a tunnel (`webhook:set`) sends your messages to the **local** database until you run
`webhook:set:prod` again. Use the fake-alias checklist above, never real entries.
