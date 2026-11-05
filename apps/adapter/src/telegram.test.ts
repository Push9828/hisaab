import { MemoryStore, type LedgerStore, type LedgerTxn } from '@hisaab/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  handleWebhook,
  parseConfig,
  type LogLabel,
  type WebhookConfig,
} from './telegram';

// All ids, names and numbers here are fake.
const SECRET = 'test-secret_0123456789_abcdefghijkl'; // 34 chars, fake
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
  const post = (body: unknown, secret: string | null = SECRET) =>
    handleWebhook(
      {
        headers:
          secret === null ? {} : { 'x-telegram-bot-api-secret-token': secret },
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

const ERROR_REPLY = 'Something went wrong. Check "accounts" before resending.';

/** Wraps a store so `insertTransaction` throws the first `times` calls, after the claim. */
function failingInserts(inner: MemoryStore, times: number): LedgerStore {
  let left = times;
  return {
    run: (fn) =>
      inner.run((txn) =>
        fn({
          ...txn,
          insertTransaction: (tx, meta) =>
            left-- > 0
              ? Promise.reject(new Error('connection lost'))
              : txn.insertTransaction(tx, meta),
        } satisfies LedgerTxn),
      ),
  };
}

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
    ['bad characters', 'has space'.padEnd(40, 'x')],
    ['too short', 'a'.repeat(31)],
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
    ['zero', '0'],
    ['negative', '-5'],
    ['zero-padded', '01'],
    ['beyond safe integers', '9007199254740993'],
  ])('rejects a %s user id', (_, id) => {
    expect(() => parseConfig(env({ TELEGRAM_ALLOWED_USER_ID: id }))).toThrow(
      /TELEGRAM_ALLOWED_USER_ID/,
    );
  });
});

describe('handleWebhook: secret header (SPEC section 9, hard rule 10)', () => {
  it.each([
    ['missing', null],
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
      'a forwarded message',
      {
        update_id: 4,
        message: {
          ...update('dinner 4000 icici').message,
          forward_origin: { type: 'user', date: DATE },
        },
      },
    ],
    [
      'a forwarded message (legacy field)',
      {
        update_id: 5,
        message: {
          ...update('dinner 4000 icici').message,
          forward_from: { id: STRANGER },
        },
      },
    ],
    [
      'a message sent via an inline bot',
      {
        update_id: 6,
        message: { ...update('dinner 4000 icici').message, via_bot: { id: 1 } },
      },
    ],
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
    const { transactions, processed } = store.snapshot();
    expect(transactions[0]?.externalId).toBe(`${CHAT}:78`);
    expect(processed).toEqual([
      JSON.stringify(['telegram', `${CHAT}:77`]),
      JSON.stringify(['telegram', `${CHAT}:78`]),
    ]);
  });

  it('a clarification replies and writes nothing', async () => {
    const store = new MemoryStore();
    const before = store.snapshot();
    const { say, logs } = setup(store);
    expect(await say('petrol 4k')).toEqual(
      replyTo('Which account? Known accounts: none yet.'),
    );
    expect(store.snapshot()).toEqual(before);
    expect(logs).toEqual(['processed']);
  });

  it('/start gets the normal unknown-command clarification', async () => {
    const store = new MemoryStore();
    const before = store.snapshot();
    const { say, logs } = setup(store);
    const res = await say('/start');
    expect(res.status).toBe(200);
    expect(res.body?.text).toMatch(/^I did not understand that\./);
    expect(store.snapshot()).toEqual(before);
    expect(logs).toEqual(['processed']);
  });

  it('never sends an empty reply (Telegram rejects it)', async () => {
    const store = {
      run: () => Promise.resolve({ reply: '', duplicate: false }),
    } as unknown as LedgerStore;
    const { say } = setup(store);
    expect(await say('accounts')).toEqual(NO_REPLY);
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

  it('a replayed open creates one account', async () => {
    const store = new MemoryStore();
    const { post } = setup(store);
    const open = update('open icici 0 bank');
    await post(open);
    expect(await post(open)).toEqual(replyTo('Already processed.'));
    expect(store.snapshot().accounts).toHaveLength(1);
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

describe('handleWebhook: any thrown error, e.g. the store (hard rule 8)', () => {
  it('replies with 200 and a check-first hint, and logs only a label', async () => {
    const leaky = new Error(
      'insert failed: params ["petrol 4k cc icici", 400000]',
    );
    const store: LedgerStore = { run: () => Promise.reject(leaky) };
    const consoleSpies = (
      ['log', 'info', 'warn', 'error', 'debug'] as const
    ).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const { say, logs } = setup(store);

    expect(await say('petrol 4k cc icici')).toEqual(replyTo(ERROR_REPLY));
    expect(logs).toEqual(['error']);
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });

  it('a failure after the claim rolls the claim back, so a retry is processed', async () => {
    const inner = new MemoryStore();
    const { post, say } = setup(failingInserts(inner, 1));
    await say('open icici 0 bank');
    const salary = update('in 1k salary icici');
    expect(await post(salary)).toEqual(replyTo(ERROR_REPLY));
    expect(inner.snapshot().transactions).toHaveLength(0);
    const retry = await post(salary);
    expect(retry.body?.text).toMatch(/^Logged: 1,000/);
    expect(inner.snapshot().transactions).toHaveLength(1);
  });
});

describe('handleWebhook: category fallback', () => {
  const ACCOUNT = {
    id: 'a',
    alias: 'tbank',
    name: 'TBANK',
    kind: 'BANK',
    openingBalance: 100_000n,
  } as const;

  function withCategorizer(ask: () => Promise<unknown>) {
    const logs: LogLabel[] = [];
    const spy = vi.fn(ask);
    const post = (body: unknown, secret = SECRET) =>
      handleWebhook(
        {
          headers: { 'x-telegram-bot-api-secret-token': secret },
          body: JSON.stringify(body),
        },
        {
          config: CONFIG,
          store: new MemoryStore([ACCOUNT]),
          log: (label) => logs.push(label),
          categorizer: { ask: spy },
        },
      );
    return { post, logs, spy };
  }

  it('replies with the guess and logs its label', async () => {
    const { post, logs } = withCategorizer(() =>
      Promise.resolve('{"category":"Food"}'),
    );
    expect(await post(update('chai 20 tbank'))).toEqual(
      replyTo(
        'Logged: 20 Chai (Food, guessed) on TBANK. Reply "undo" to revert.',
      ),
    );
    expect(logs).toEqual(['llm_guessed', 'processed']);
  });

  it('logs unsure', async () => {
    const { post, logs } = withCategorizer(() =>
      Promise.resolve('{"category":"unsure"}'),
    );
    await post(update('asdf 20 tbank'));
    expect(logs).toEqual(['llm_unsure', 'processed']);
  });

  it('a failed call still logs the message and logs labels only', async () => {
    const lines: unknown[][] = [];
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, m).mockImplementation((...args) => {
        lines.push(args);
      });
    }
    const { post, logs } = withCategorizer(() =>
      Promise.reject(new Error('fake failure quoting chai 20 tbank')),
    );
    expect(await post(update('chai 20 tbank'))).toEqual(
      replyTo(
        'Logged: 20 Chai (category needs review) on TBANK. Reply "undo" to revert.',
      ),
    );
    expect(logs).toEqual(['llm_failed', 'processed']);
    expect(lines).toEqual([]);
  });

  it('a keyword hit makes no call and logs no llm label', async () => {
    const { post, logs, spy } = withCategorizer(() => Promise.resolve(null));
    await post(update('petrol 20 tbank'));
    expect(spy).not.toHaveBeenCalled();
    expect(logs).toEqual(['processed']);
  });

  it.each([
    ['a wrong secret', {}, 'wrong-secret'],
    ['a stranger', { fromId: STRANGER }, SECRET],
    ['a group chat', { chatType: 'group' }, SECRET],
  ])('%s never reaches the LLM', async (_, overrides, secret) => {
    const { post, spy } = withCategorizer(() => Promise.resolve(null));
    await post(update('chai 20 tbank', overrides), secret);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('handleWebhook: ask', () => {
  const ACCOUNT = {
    id: 'a',
    alias: 'tbank',
    name: 'TBANK',
    kind: 'BANK',
    openingBalance: 100_000n,
  } as const;

  function withPicker(pick: () => Promise<unknown>) {
    const logs: LogLabel[] = [];
    const spy = vi.fn(pick);
    const post = (body: unknown, secret = SECRET) =>
      handleWebhook(
        {
          headers: { 'x-telegram-bot-api-secret-token': secret },
          body: JSON.stringify(body),
        },
        {
          config: CONFIG,
          store: new MemoryStore([ACCOUNT]),
          log: (label) => logs.push(label),
          reportPicker: { pick: spy },
        },
      );
    return { post, logs, spy };
  }
  const TOTAL = JSON.stringify({
    report: 'total',
    month: 'this_month',
    category: 'none',
  });

  it('answers and logs its label', async () => {
    const { post, logs } = withPicker(() => Promise.resolve(TOTAL));
    expect(await post(update('ask total'))).toEqual(
      replyTo('Oct 2026, all spending: 0.'),
    );
    expect(logs).toEqual(['llm_answered', 'processed']);
  });

  it('a failed call logs labels only, with canaries in the question and the error', async () => {
    const lines: unknown[][] = [];
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, m).mockImplementation((...args) => {
        lines.push(args);
      });
    }
    const { post, logs } = withPicker(() =>
      Promise.reject(new Error('fake failure quoting canaryword')),
    );
    const res = await post(update('ask canaryword'));
    expect(JSON.stringify(res)).not.toContain('fake failure');
    expect(logs).toEqual(['llm_failed', 'processed']);
    expect(lines).toEqual([]);
  });

  it('a refused question logs no llm label and makes no call', async () => {
    const { post, logs, spy } = withPicker(() => Promise.resolve(TOTAL));
    await post(update('ask spend on tbank'));
    expect(spy).not.toHaveBeenCalled();
    expect(logs).toEqual(['processed']);
  });

  it.each([
    ['a wrong secret', {}, 'wrong-secret'],
    ['a stranger', { fromId: STRANGER }, SECRET],
    ['a group chat', { chatType: 'group' }, SECRET],
  ])('%s never reaches the LLM', async (_, overrides, secret) => {
    const { post, spy } = withPicker(() => Promise.resolve(TOTAL));
    await post(update('ask total', overrides), secret);
    expect(spy).not.toHaveBeenCalled();
  });

  it('a forward never reaches the LLM', async () => {
    const { post, spy } = withPicker(() => Promise.resolve(TOTAL));
    const forwarded = update('ask total');
    await post({
      ...forwarded,
      message: { ...forwarded.message, forward_origin: { type: 'user' } },
    });
    expect(spy).not.toHaveBeenCalled();
  });
});
