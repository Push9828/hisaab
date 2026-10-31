/**
 * Read-only: asks Telegram where the bot's webhook points and whether the last
 * delivery failed. Usage: pnpm --filter @hisaab/adapter webhook:info
 *
 * The bot token is part of the request URL, so neither the URL nor any fetch
 * error is ever printed. Only the webhook host and status fields are.
 */

export {}; // a module, for top-level await

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');

interface WebhookInfo {
  url: string;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
  max_connections?: number;
  allowed_updates?: string[];
}

let response: Response;
try {
  response = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
} catch {
  throw new Error('Request to Telegram failed (network)');
}
const body = (await response.json()) as {
  ok: boolean;
  result?: WebhookInfo;
  description?: string;
};
if (!body.ok || !body.result) {
  console.log(`failed: ${body.description}`);
  process.exitCode = 1;
} else {
  const r = body.result;
  const url = r.url ? new URL(r.url) : null;
  console.log({
    host: url?.host ?? '(no webhook set)',
    path: url?.pathname ?? '-',
    pending_update_count: r.pending_update_count,
    last_error_date: r.last_error_date
      ? new Date(r.last_error_date * 1000).toISOString()
      : null,
    last_error_message: r.last_error_message ?? null,
    max_connections: r.max_connections,
    allowed_updates: r.allowed_updates,
  });
}
