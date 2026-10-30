import { createHash, timingSafeEqual } from 'node:crypto';

import { ingest, type LedgerStore } from '@hisaab/core';

export interface WebhookConfig {
  secret: string;
  /** The one Telegram user whose messages are processed. */
  allowedUserId: number;
}

/** The only things the adapter ever logs. Never text, balances or errors (hard rule 8). */
export type LogLabel =
  'unauthorized' | 'ignored' | 'processed' | 'duplicate' | 'error';

export interface WebhookRequest {
  /** Lowercase header names, as `node:http` gives them. */
  headers: Readonly<Record<string, string | string[] | undefined>>;
  body: string;
}

/** Telegram accepts a method call as the webhook response, so this is the reply. */
interface SendMessage {
  method: 'sendMessage';
  chat_id: number;
  text: string;
}

export interface WebhookResponse {
  status: number;
  body?: SendMessage;
}

export interface WebhookDeps {
  config: WebhookConfig;
  store: LedgerStore;
  log: (label: LogLabel) => void;
}

/** The fields we read from a Telegram `Message`. Everything else is ignored. */
interface TextMessage {
  message_id: number;
  date: number;
  chat: { id: number; type: string };
  from: { id: number };
  text: string;
}

const SECRET_HEADER = 'x-telegram-bot-api-secret-token';
const SECRET_FORMAT = /^[A-Za-z0-9_-]{1,256}$/;
const ERROR_REPLY = 'Something went wrong, nothing was saved. Try again.';

/** Reads adapter settings from the environment. Throws (without echoing values) if any is unsafe. */
export function parseConfig(
  env: Readonly<Record<string, string | undefined>>,
): WebhookConfig {
  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || !SECRET_FORMAT.test(secret)) {
    throw new Error(
      'TELEGRAM_WEBHOOK_SECRET must be 1-256 characters of A-Z a-z 0-9 _ -',
    );
  }
  const id = env.TELEGRAM_ALLOWED_USER_ID ?? '';
  const allowedUserId = Number(id);
  if (!/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(allowedUserId)) {
    throw new Error(
      'TELEGRAM_ALLOWED_USER_ID must be a numeric Telegram user id',
    );
  }
  return { secret, allowedUserId };
}

/**
 * One Telegram webhook delivery. Checks run in this order: secret, shape,
 * sender, then `ingest`. Anything we do not handle gets a silent 200 so
 * Telegram does not retry it.
 */
export async function handleWebhook(
  req: WebhookRequest,
  { config, store, log }: WebhookDeps,
): Promise<WebhookResponse> {
  if (!secretMatches(req.headers[SECRET_HEADER], config.secret)) {
    log('unauthorized');
    return { status: 401 };
  }

  const message = textMessage(req.body);
  if (
    !message ||
    message.chat.type !== 'private' ||
    message.from.id !== config.allowedUserId
  ) {
    log('ignored');
    return { status: 200 };
  }

  const send = (text: string): WebhookResponse => ({
    status: 200,
    body: { method: 'sendMessage', chat_id: message.chat.id, text },
  });

  try {
    const result = await ingest(
      {
        channel: 'telegram',
        externalId: `${message.chat.id}:${message.message_id}`,
        text: message.text,
        now: new Date(message.date * 1000),
      },
      store,
    );
    log(result.duplicate ? 'duplicate' : 'processed');
    return send(result.reply);
  } catch {
    // The error may carry query parameters, i.e. the message text. Never log it.
    // The run rolled back, so resending is safe.
    log('error');
    return send(ERROR_REPLY);
  }
}

function secretMatches(
  header: string | string[] | undefined,
  secret: string,
): boolean {
  if (typeof header !== 'string') return false;
  // Hashing gives equal lengths, which timingSafeEqual requires.
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(header), digest(secret));
}

/** `update.message` if it is a text message we can process, else null. Edits are not `message`. */
function textMessage(body: string): TextMessage | null {
  let update: unknown;
  try {
    update = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isObject(update) || !isObject(update.message)) return null;
  const { message_id, date, chat, from, text } = update.message;
  if (
    !Number.isSafeInteger(message_id) ||
    !Number.isSafeInteger(date) ||
    !isObject(chat) ||
    !Number.isSafeInteger(chat.id) ||
    typeof chat.type !== 'string' ||
    !isObject(from) ||
    !Number.isSafeInteger(from.id) ||
    typeof text !== 'string'
  ) {
    return null;
  }
  return {
    message_id: message_id as number,
    date: date as number,
    chat: { id: chat.id as number, type: chat.type },
    from: { id: from.id as number },
    text,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
