import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { createDb, DrizzleStore } from '@hisaab/db';

import {
  handleHttpApi,
  type HttpApiEvent,
  type HttpApiResult,
  type HttpLogLabel,
} from './http-api';
import { parseConfig, type WebhookConfig } from './telegram';

/**
 * Lambda entry point behind API Gateway (HTTP API). Logs fixed labels only:
 * Lambda prints an escaped error's message and stack, and SDK and pg errors
 * can hold connection details or query parameters (hard rule 8). So nothing
 * may escape `handler`.
 */

interface Settings {
  config: WebhookConfig;
  databaseUrl: string;
}

/** The keys we read from the one JSON secret. Values must be strings. */
const KEYS = [
  'TELEGRAM_WEBHOOK_SECRET',
  'TELEGRAM_ALLOWED_USER_ID',
  'DATABASE_URL',
] as const;

const log = (label: HttpLogLabel) => console.log(label);
const client = new SecretsManagerClient({});

/** Fetched once per cold start. Cleared on failure so the next call retries. */
let settings: Promise<Settings> | undefined;

function loadSettings(): Promise<Settings> {
  settings ??= fetchSettings().catch((err: unknown) => {
    settings = undefined;
    throw err;
  });
  return settings;
}

async function fetchSettings(): Promise<Settings> {
  const secretId = process.env.SECRET_ID;
  if (!secretId) throw new Error('SECRET_ID is not set');
  const { SecretString } = await client.send(
    new GetSecretValueCommand({ SecretId: secretId }),
  );
  // A parse error can quote the secret; it is never logged (see handler).
  const parsed: unknown = JSON.parse(SecretString ?? '');
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('secret is not a JSON object');
  }
  const values: Record<string, string | undefined> = {};
  for (const key of KEYS) {
    const value = (parsed as Record<string, unknown>)[key];
    values[key] = typeof value === 'string' ? value : undefined;
  }
  const config = parseConfig(values);
  if (!values.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  return { config, databaseUrl: values.DATABASE_URL };
}

export async function handler(event: HttpApiEvent): Promise<HttpApiResult> {
  let settingsNow: Settings;
  try {
    settingsNow = await loadSettings();
  } catch {
    // Nothing was processed, so a 500 is safe: Telegram retries later.
    log('error');
    return { statusCode: 500 };
  }

  // A fresh pool per invocation: a frozen Lambda keeps dead idle sockets,
  // which would fail the first message after a quiet spell. pg connects
  // lazily, so a 401 never opens a connection.
  const { db, pool } = createDb(settingsNow.databaseUrl);
  pool.on('error', () => log('error'));
  try {
    // Never throws: handleWebhook turns processing errors into a reply.
    return await handleHttpApi(event, {
      config: settingsNow.config,
      store: new DrizzleStore(db),
      log,
    });
  } finally {
    // The reply is already decided; a failed close must not turn it into a 500.
    await pool.end().catch(() => log('error'));
  }
}
