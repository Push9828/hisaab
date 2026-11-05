import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HttpApiEvent } from './http-api';
import type { MemoryAccount } from '@hisaab/core';
import type * as HisaabDb from '@hisaab/db';

// All ids, secrets and URLs here are fake.
const SECRET = 'test-secret_0123456789_abcdefghijkl'; // 34 chars, fake
const ME = 100000001;
const DB_URL = 'postgresql://fake:fake-password@db.invalid:5432/fake';
const SECRET_ID = 'arn:aws:secretsmanager:ap-south-1:000000000000:secret:fake';
const CA = 'fake CA';

const aws = vi.hoisted(() => ({ send: vi.fn() }));
const pg = vi.hoisted(() => ({
  end: vi.fn<() => Promise<void>>(),
  on: vi.fn(),
  createDb: vi.fn(),
  accounts: [] as MemoryAccount[],
}));

vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class {
    send = aws.send;
  },
  GetSecretValueCommand: class {
    constructor(readonly input: unknown) {}
  },
}));

vi.mock('@hisaab/db', async () => {
  const { MemoryStore } = await import('@hisaab/core');
  const { parseDatabaseUrl } =
    await vi.importActual<typeof HisaabDb>('@hisaab/db');
  return {
    SUPABASE_ROOT_CA: CA,
    parseDatabaseUrl,
    createDb: pg.createDb.mockImplementation(() => ({
      db: {},
      pool: { on: pg.on, end: pg.end },
    })),
    // Ignores the db handle it is given; a fresh in-memory ledger each time, with pg.accounts.
    DrizzleStore: class extends MemoryStore {
      constructor() {
        super(pg.accounts);
      }
    },
  };
});

const secretString = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    TELEGRAM_WEBHOOK_SECRET: SECRET,
    TELEGRAM_ALLOWED_USER_ID: String(ME),
    DATABASE_URL: DB_URL,
    ...overrides,
  });

function event(
  text: string,
  secret: string | null = SECRET,
  messageId = 1,
): HttpApiEvent {
  return {
    headers:
      secret === null ? {} : { 'x-telegram-bot-api-secret-token': secret },
    body: JSON.stringify({
      update_id: 1,
      message: {
        message_id: messageId,
        date: Date.UTC(2026, 9, 26, 10, 0) / 1000,
        chat: { id: ME, type: 'private' },
        from: { id: ME },
        text,
      },
    }),
    isBase64Encoded: false,
  };
}

/** Everything written to the console, one array of arguments per call. */
let consoleCalls: unknown[][];

/** A fresh copy of lambda.ts, so the cached secret does not leak between tests. */
async function load() {
  vi.resetModules();
  return (await import('./lambda')).handler;
}

beforeEach(() => {
  vi.stubEnv('SECRET_ID', SECRET_ID);
  aws.send.mockReset().mockResolvedValue({ SecretString: secretString() });
  pg.end.mockReset().mockResolvedValue();
  pg.on.mockClear();
  pg.createDb.mockClear();
  pg.accounts = [];
  consoleCalls = [];
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, m).mockImplementation((...args) => {
      consoleCalls.push(args);
    });
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('lambda handler', () => {
  it('answers a message through the real webhook handler', async () => {
    const handler = await load();
    const res = await handler(event('accounts'));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body ?? '')).toMatchObject({
      method: 'sendMessage',
      chat_id: ME,
    });
    expect(consoleCalls).toEqual([['processed']]);
  });

  it('reads the secret by SECRET_ID once, then reuses it on warm invocations', async () => {
    const handler = await load();
    await handler(event('accounts', SECRET, 1));
    await handler(event('accounts', SECRET, 2));
    expect(aws.send).toHaveBeenCalledTimes(1);
    expect(aws.send.mock.calls[0]?.[0]).toMatchObject({
      input: { SecretId: SECRET_ID },
    });
    expect(pg.createDb).toHaveBeenCalledWith(DB_URL, { ca: CA, max: 1 });
    expect(pg.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('opens a fresh pool per invocation and always ends it', async () => {
    const handler = await load();
    await handler(event('accounts', SECRET, 1));
    await handler(event('accounts', null, 2)); // 401
    expect(pg.createDb).toHaveBeenCalledTimes(2);
    expect(pg.end).toHaveBeenCalledTimes(2);
  });

  it('a wrong secret is 401 and logs only the label', async () => {
    const handler = await load();
    expect(await handler(event('accounts', 'wrong-secret'))).toEqual({
      statusCode: 401,
    });
    expect(consoleCalls).toEqual([['unauthorized']]);
  });

  it('a failing pool.end does not lose the reply', async () => {
    pg.end.mockRejectedValue(new Error(`connection to ${DB_URL} lost`));
    const handler = await load();
    const res = await handler(event('accounts'));
    expect(res.statusCode).toBe(200);
    expect(res.body).toBeDefined();
    expect(consoleCalls).toEqual([['processed'], ['error']]);
  });

  it('a throw outside handleWebhook is a 500 with only the label', async () => {
    pg.createDb.mockImplementationOnce(() => {
      throw new Error(`cannot connect to ${DB_URL}`);
    });
    const handler = await load();
    expect(await handler(event('accounts'))).toEqual({ statusCode: 500 });
    expect(consoleCalls).toEqual([['error']]);
  });
});

describe('lambda handler: SARVAM_API_KEY is optional', () => {
  const SARVAM_KEY = 'fake-sarvam-key';
  const ACCOUNT = {
    id: 'a',
    alias: 'tbank',
    name: 'TBANK',
    kind: 'BANK',
    openingBalance: 100_000n,
  } as const;
  const replyText = (body: string | undefined) =>
    (JSON.parse(body ?? '') as { text: string }).text;

  const fetchStub = vi.fn<typeof fetch>();

  beforeEach(() => {
    pg.accounts = [ACCOUNT];
    fetchStub.mockReset().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"category":"Food"}' } }],
          }),
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchStub);
  });

  it('with the key, a miss is guessed and logs labels only', async () => {
    aws.send.mockResolvedValue({
      SecretString: secretString({ SARVAM_API_KEY: SARVAM_KEY }),
    });
    const handler = await load();
    const res = await handler(event('chai 20 tbank'));
    expect(replyText(res.body)).toContain('(Food, guessed)');
    expect(fetchStub).toHaveBeenCalledOnce();
    const [, init] = fetchStub.mock.calls[0] ?? [];
    expect(init?.headers).toMatchObject({
      'api-subscription-key': SARVAM_KEY,
    });
    expect(consoleCalls).toEqual([['llm_guessed'], ['processed']]);
  });

  it('with the key, a failed call still logs the entry and only labels', async () => {
    aws.send.mockResolvedValue({
      SecretString: secretString({ SARVAM_API_KEY: SARVAM_KEY }),
    });
    fetchStub.mockRejectedValue(
      new Error(`request with ${SARVAM_KEY} for chai failed`),
    );
    const handler = await load();
    const res = await handler(event('chai 20 tbank'));
    expect(res.statusCode).toBe(200);
    expect(replyText(res.body)).toContain('category needs review');
    expect(consoleCalls).toEqual([['llm_failed'], ['processed']]);
  });

  it.each([
    ['missing', {}],
    ['empty', { SARVAM_API_KEY: '' }],
    ['not a string', { SARVAM_API_KEY: 7 }],
  ])('%s, the bot uses keyword rules only', async (_, overrides) => {
    aws.send.mockResolvedValue({ SecretString: secretString(overrides) });
    const handler = await load();
    const res = await handler(event('chai 20 tbank'));
    expect(res.statusCode).toBe(200);
    expect(replyText(res.body)).toContain('category needs review');
    expect(fetchStub).not.toHaveBeenCalled();
    expect(consoleCalls).toEqual([['processed']]);
  });
});

describe('lambda handler: settings failures (500, so Telegram retries; labels only)', () => {
  it('a Secrets Manager failure is retried on the next invocation', async () => {
    aws.send.mockRejectedValueOnce(
      new Error(`AccessDenied on ${SECRET_ID}`), // fake
    );
    const handler = await load();
    expect(await handler(event('accounts', SECRET, 1))).toEqual({
      statusCode: 500,
    });
    expect(consoleCalls).toEqual([['error']]);

    const retry = await handler(event('accounts', SECRET, 2));
    expect(retry.statusCode).toBe(200);
    expect(aws.send).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['not JSON', { SecretString: `oops ${DB_URL}` }],
    ['a JSON array', { SecretString: '[]' }],
    ['no SecretString', {}],
    ['no DATABASE_URL', { SecretString: secretString({ DATABASE_URL: '' }) }],
    [
      'a weak webhook secret',
      { SecretString: secretString({ TELEGRAM_WEBHOOK_SECRET: 'short' }) },
    ],
    [
      'ssl parameters in DATABASE_URL',
      {
        SecretString: secretString({
          DATABASE_URL: `${DB_URL}?sslmode=disable`,
        }),
      },
    ],
    [
      'an encoded ssl parameter in DATABASE_URL',
      {
        SecretString: secretString({
          DATABASE_URL: `${DB_URL}?%73slmode=disable`,
        }),
      },
    ],
    [
      'a DATABASE_URL that is not a URL',
      { SecretString: secretString({ DATABASE_URL: 'postgresql://u:p#w@/x' }) },
    ],
    [
      'a numeric user id (secret values must be strings)',
      { SecretString: secretString({ TELEGRAM_ALLOWED_USER_ID: ME }) },
    ],
  ])('a secret with %s', async (_, value) => {
    aws.send.mockResolvedValue(value);
    const handler = await load();
    expect(await handler(event('accounts'))).toEqual({ statusCode: 500 });
    expect(consoleCalls).toEqual([['error']]);
    expect(pg.createDb).not.toHaveBeenCalled();
  });

  it('a missing SECRET_ID never calls AWS', async () => {
    vi.stubEnv('SECRET_ID', '');
    const handler = await load();
    expect(await handler(event('accounts'))).toEqual({ statusCode: 500 });
    expect(aws.send).not.toHaveBeenCalled();
    expect(consoleCalls).toEqual([['error']]);
  });
});
