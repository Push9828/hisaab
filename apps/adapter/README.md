# @hisaab/adapter

Telegram webhook adapter. In M3 it runs on your laptop behind a tunnel. In M4 it moves to Lambda.

```
Phone -> Telegram -> tunnel -> local.ts (127.0.0.1:8787) -> handleWebhook -> core.ingest -> Postgres
                                                     reply <- { method: 'sendMessage', ... } (the response body)
```

`handleWebhook` (`src/telegram.ts`) checks the secret header, then the message shape, then the
sender. Anything it does not handle gets a silent 200. Logs are a startup line plus fixed labels
(`unauthorized`, `ignored`, `processed`, `duplicate`, `error`, `bad_request`, `aborted`), never
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
tg getWebhookInfo | grep -oE '"(url|pending_update_count|last_error_message)":("[^"]*"|[0-9]+)'
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
