import { parseConfig } from '../src/telegram';

/**
 * Points the bot's webhook at a public HTTPS URL (the tunnel in M3).
 * Usage: pnpm --filter @hisaab/adapter webhook:set https://<tunnel-host>
 *
 * The bot token is part of the request URL, so neither the URL nor any
 * fetch error is ever printed. Only Telegram's verdict is.
 */

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
const { secret } = parseConfig(process.env);

const raw = process.argv[2];
const url = raw ? new URL(raw) : null;
// local.ts only serves POST /, so the webhook must point at the root.
if (!url || url.protocol !== 'https:' || url.pathname !== '/' || url.search) {
  throw new Error('Pass the tunnel root as https://<host>/ (no path)');
}

let response: Response;
try {
  response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: url.href,
      secret_token: secret,
      // Edits and everything else are never delivered.
      allowed_updates: ['message'],
    }),
  });
} catch {
  throw new Error('Request to Telegram failed (network)');
}

const result = (await response.json()) as { ok: boolean; description?: string };
console.log(
  result.ok
    ? `ok: webhook set to ${url.host}`
    : `failed: ${result.description}`,
);
if (!result.ok) process.exitCode = 1;
