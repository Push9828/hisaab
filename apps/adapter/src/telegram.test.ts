import { MemoryStore, type LedgerStore } from '@hisaab/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  handleWebhook,
  parseConfig,
  type LogLabel,
  type WebhookConfig,
} from './telegram';

// All ids, names and numbers here are fake.
const SECRET = 'test-secret_0123456789';
const ME = 100000001;
const STRANGER = 100000002;
const CHAT = ME; // a private chat's id is the user's id
const CONFIG: WebhookConfig = { secret: SECRET, allowedUserId: ME };

// 2026-10-26 15:30 IST, as Telegram's unix seconds.
const DATE = Date.UTC(2026, 9, 26, 10, 0) / 1000;

let nextMessageId = 1;

function update(
  text: string,
  overrides: {
    message_id?: number;
    date?: number;
    fromId?: number;
    chatType?: string;
  } = {},
) {
  return {
    update_id: 500000 + nextMessageId,
    message: {
      message_id: overrides.message_id ?? nextMessageId++,
      date: overrides.date ?? DATE,
      chat: { id: CHAT, type: overrides.chatType ?? 'private' },
      from: { id: overrides.fromId ?? ME, is_bot: false, first_name: 'Test' },
      text,
    },
  };
}

function setup(store: LedgerStore = new MemoryStore()) {
  const logs: LogLabel[] = [];
  const post = (body: unknown, secret: string | undefined = SECRET) =>
    handleWebhook(
      {
        headers:
          secret === undefined
            ? {}
            : { 'x-telegram-bot-api-secret-token': secret },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      },
      { config: CONFIG, store, log: (label) => logs.push(label) },
    );
  const say = (text: string) => post(update(text));
  return { post, say, logs };
}

const replyTo = (text: string) => ({
  status: 200,
  body: { method: 'sendMessage', chat_id: CHAT, text },
});

const NO_REPLY = { status: 200 };

afterEach(() => vi.restoreAllMocks());

describe('parseConfig: refuses to start on a weak or missing setting', () => {
  const env = (overrides: Record<string, string | undefined>) => ({
    TELEGRAM_WEBHOOK_SECRET: SECRET,
    TELEGRAM_ALLOWED_USER_ID: String(ME),
    ...overrides,
  });

  it('accepts a valid secret and numeric user id', () => {
    expect(parseConfig(env({}))).toEqual(CONFIG);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['bad characters', 'has space'],
    ['too long', 'a'.repeat(257)],
  ])('rejects a %s secret, without echoing it', (_, secret) => {
    const run = () => parseConfig(env({ TELEGRAM_WEBHOOK_SECRET: secret }));
    expect(run).toThrow(/TELEGRAM_WEBHOOK_SECRET/);
    if (secret) expect(run).not.toThrow(secret);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['not a number', 'me'],
    ['not an integer', '1.5'],
  ])('rejects a %s user id', (_, id) => {
    expect(() => parseConfig(env({ TELEGRAM_ALLOWED_USER_ID: id }))).toThrow(
      /TELEGRAM_ALLOWED_USER_ID/,
    );
  });
});

describe('handleWebhook: secret header (SPEC section 9, hard rule 10)', () => {
  it.each([
    ['missing', undefined],
    ['wrong', 'wrong-secret'],
    ['a prefix of the real one', SECRET.slice(0, -1)],
    ['empty', ''],
  ])(
    '401 and the store is never touched when the secret is %s',
    async (_, secret) => {
      const store = new MemoryStore();
      const run = vi.spyOn(store, 'run');
      const { post, logs } = setup(store);
      expect(await post(update('open icici 0 bank'), secret)).toEqual({
        status: 401,
      });
      expect(run).not.toHaveBeenCalled();
      expect(logs).toEqual(['unauthorized']);
    },
  );

  it('rejects a repeated header (array value)', async () => {
    const store = new MemoryStore();
    const run = vi.spyOn(store, 'run');
    const res = await handleWebhook(
      {
        headers: { 'x-telegram-bot-api-secret-token': [SECRET, SECRET] },
        body: JSON.stringify(update('accounts')),
      },
      { config: CONFIG, store, log: () => {} },
    );
    expect(res).toEqual({ status: 401 });
    expect(run).not.toHaveBeenCalled();
  });
});

describe('handleWebhook: ignored silently, nothing written', () => {
  it.each([
    ['a stranger', update('open icici 0 bank', { fromId: STRANGER })],
    ['a group chat', update('open icici 0 bank', { chatType: 'group' })],
    [
      'an edited message',
      { update_id: 1, edited_message: update('open icici 0 bank').message },
    ],
    [
      'a non-text message',
      {
        update_id: 2,
        message: { ...update('').message, text: undefined, sticker: {} },
      },
    ],
    ['malformed JSON', '{"update_id": '],
    ['a JSON non-object', '42'],
    [
      'a message without a sender',
      {
        update_id: 3,
        message: { ...update('accounts').message, from: undefined },
      },
    ],
  ])('%s', async (_, body) => {
    const store = new MemoryStore();
    const before = store.snapshot();
    const { post, logs } = setup(store);
    expect(await post(body)).toEqual(NO_REPLY);
    expect(store.snapshot()).toEqual(before);
    expect(logs).toEqual(['ignored']);
  });
});

describe('handleWebhook: messages reach ingest and the reply goes back', () => {
  it('SPEC example 1: credit card spend is written and confirmed', async () => {
    const store = new MemoryStore();
    const { say, logs } = setup(store);
    await say('open icicicc 0 cc');
    expect(await say('petrol 4k cc icici')).toEqual(
      replyTo(
        'Logged: 4,000 Petrol (Transport) on ICICICC. Reply "undo" to revert.',
      ),
    );
    const [tx] = store.snapshot().transactions;
    expect(tx).toMatchObject({
      channel: 'telegram',
      rawText: 'petrol 4k cc icici',
      proposed: { type: 'EXPENSE', spendAmount: 400_000n },
    });
    expect(logs).toEqual(['processed', 'processed']);
  });

  it('externalId is chat id and message id', async () => {
    const store = new MemoryStore();
    const { post } = setup(store);
    await post(update('open icici 0 bank', { message_id: 77 }));
    await post(update('in 1k salary icici', { message_id: 78 }));
    expect(store.snapshot().transactions[0]?.externalId).toBe(`${CHAT}:78`);
  });

  it('a clarification replies and writes nothing', async () => {
    const store = new MemoryStore();
    const { say } = setup(store);
    const res = await say('petrol 4k');
    expect(res.status).toBe(200);
    expect(res.body?.text).toBeTruthy();
    expect(store.snapshot().transactions).toEqual([]);
  });

  it('/start gets the normal clarification', async () => {
    const { say } = setup();
    const res = await say('/start');
    expect(res.status).toBe(200);
    expect(res.body?.text).toBeTruthy();
  });
});

describe('handleWebhook: replays (SPEC invariant 5)', () => {
  it('the same update twice writes once and answers "Already processed."', async () => {
    const store = new MemoryStore();
    const { post, logs } = setup(store);
    await post(update('open icici 0 bank'));
    const spend = update('in 1k salary icici');
    await post(spend);
    expect(await post(spend)).toEqual(replyTo('Already processed.'));
    expect(store.snapshot().transactions).toHaveLength(1);
    expect(logs.at(-1)).toBe('duplicate');
  });

  it('a replayed undo voids only one transaction', async () => {
    const store = new MemoryStore();
    const { post, say } = setup(store);
    await say('open icici 0 bank');
    await say('in 1k salary icici');
    await say('in 2k salary icici');
    const undo = update('undo');
    await post(undo);
    expect(await post(undo)).toEqual(replyTo('Already processed.'));
    const voided = store
      .snapshot()
      .transactions.filter((t) => t.voidedAt !== null);
    expect(voided).toHaveLength(1);
  });
});

describe('handleWebhook: time comes from message.date', () => {
  it('an undated entry is stamped with message.date, not the server clock', async () => {
    const store = new MemoryStore();
    const { post, say } = setup(store);
    await say('open icici 0 bank');
    const earlier = DATE - 3600;
    await post(update('in 1k salary icici', { date: earlier }));
    expect(store.snapshot().transactions[0]?.proposed.occurredAt).toEqual(
      new Date(earlier * 1000),
    );
  });

  it('"yesterday" just after IST midnight is the previous IST day', async () => {
    const store = new MemoryStore();
    const { post, say } = setup(store);
    await say('open icici 0 bank');
    // 2026-10-26 00:30 IST is still 2026-10-25 in UTC.
    const justAfterMidnight = Date.UTC(2026, 9, 25, 19, 0) / 1000;
    await post(
      update('yesterday in 1k salary icici', { date: justAfterMidnight }),
    );
    // 2026-10-25 12:00 IST.
    expect(store.snapshot().transactions[0]?.proposed.occurredAt).toEqual(
      new Date(Date.UTC(2026, 9, 25, 6, 30)),
    );
  });
});

describe('handleWebhook: store failure (hard rule 8)', () => {
  it('replies "nothing was saved" with 200, and logs only a label', async () => {
    const leaky = new Error(
      'insert failed: params ["petrol 4k cc icici", 400000]',
    );
    const store: LedgerStore = { run: () => Promise.reject(leaky) };
    const consoleSpies = (
      ['log', 'info', 'warn', 'error', 'debug'] as const
    ).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const { say, logs } = setup(store);

    expect(await say('petrol 4k cc icici')).toEqual(
      replyTo('Something went wrong, nothing was saved. Try again.'),
    );
    expect(logs).toEqual(['store_error']);
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });
});
