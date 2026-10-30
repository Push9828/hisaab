import { MemoryStore, type LedgerStore } from '@hisaab/core';
import { describe, expect, it, vi } from 'vitest';

import {
  handleHttpApi,
  MAX_BODY_BYTES,
  type HttpApiEvent,
  type HttpLogLabel,
} from './http-api';

import type { WebhookConfig } from './telegram';

// All ids, names and numbers here are fake.
const SECRET = 'test-secret_0123456789_abcdefghijkl'; // 34 chars, fake
const ME = 100000001;
const CONFIG: WebhookConfig = { secret: SECRET, allowedUserId: ME };
const DATE = Date.UTC(2026, 9, 26, 10, 0) / 1000;

let nextMessageId = 1;

function updateJson(text: string): string {
  const id = nextMessageId++;
  return JSON.stringify({
    update_id: 500000 + id,
    message: {
      message_id: id,
      date: DATE,
      chat: { id: ME, type: 'private' },
      from: { id: ME, is_bot: false, first_name: 'Test' },
      text,
    },
  });
}

/** An HTTP API (payload v2) event, as API Gateway hands it to the Lambda. */
function event(
  body: string | undefined,
  {
    base64 = false,
    headers = { 'x-telegram-bot-api-secret-token': SECRET },
  }: { base64?: boolean; headers?: HttpApiEvent['headers'] } = {},
): HttpApiEvent {
  return {
    headers,
    body:
      body !== undefined && base64
        ? Buffer.from(body).toString('base64')
        : body,
    isBase64Encoded: base64,
  };
}

function setup(store: LedgerStore = new MemoryStore()) {
  const logs: HttpLogLabel[] = [];
  const send = (e: HttpApiEvent) =>
    handleHttpApi(e, { config: CONFIG, store, log: (l) => logs.push(l) });
  return { send, logs, store };
}

const replyResult = (text: string) => ({
  statusCode: 200,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ method: 'sendMessage', chat_id: ME, text }),
});

describe('handleHttpApi: request mapping', () => {
  it('a plain body reaches the webhook handler and the reply comes back as JSON', async () => {
    const { send, logs } = setup();
    expect(await send(event(updateJson('accounts')))).toEqual(
      replyResult('No accounts yet. Add one: open <alias> <amount> <kind>'),
    );
    expect(logs).toEqual(['processed']);
  });

  it('a base64 body is decoded first', async () => {
    const { send, store } = setup();
    expect(
      await send(event(updateJson('open icici 0 bank'), { base64: true })),
    ).toMatchObject({ statusCode: 200 });
    expect(
      (store as MemoryStore).snapshot().accounts.map((a) => a.alias),
    ).toEqual(['icici']);
  });

  it('a base64 body with non-ASCII text is decoded as UTF-8', async () => {
    const { send, store } = setup();
    await send(event(updateJson('open icici 0 bank')));
    await send(
      event(updateJson('in 1k chai ☕ salary icici'), { base64: true }),
    );
    expect((store as MemoryStore).snapshot().transactions[0]?.rawText).toBe(
      'in 1k chai ☕ salary icici',
    );
  });

  it('a missing body is an ignored update, not a crash', async () => {
    const { send, logs } = setup();
    expect(await send(event(undefined))).toEqual({ statusCode: 200 });
    expect(logs).toEqual(['ignored']);
  });

  it('a silent 200 has no body and no content-type', async () => {
    const { send } = setup();
    expect(await send(event('{"update_id": 1}'))).toEqual({ statusCode: 200 });
  });
});

describe('handleHttpApi: secret header (hard rule 10)', () => {
  it.each([
    ['missing', {}],
    ['wrong', { 'x-telegram-bot-api-secret-token': 'wrong-secret' }],
    [
      // HTTP API v2 joins a repeated header with a comma; that must not pass.
      'repeated (comma-joined)',
      { 'x-telegram-bot-api-secret-token': `${SECRET},${SECRET}` },
    ],
    [
      // v2 lowercases names, so this never happens; if it did, fail closed.
      'not lowercased',
      { 'X-Telegram-Bot-Api-Secret-Token': SECRET },
    ],
  ])('401 and the store is never touched when it is %s', async (_, headers) => {
    const store = new MemoryStore();
    const run = vi.spyOn(store, 'run');
    const { send, logs } = setup(store);
    expect(
      await send(event(updateJson('open icici 0 bank'), { headers })),
    ).toEqual({ statusCode: 401 });
    expect(run).not.toHaveBeenCalled();
    expect(logs).toEqual(['unauthorized']);
  });

  it('a missing headers object is unauthorized', async () => {
    const { send, logs } = setup();
    expect(await send({ body: updateJson('accounts') })).toEqual({
      statusCode: 401,
    });
    expect(logs).toEqual(['unauthorized']);
  });
});

describe('handleHttpApi: body size', () => {
  const oversized = 'x'.repeat(MAX_BODY_BYTES + 1);

  it.each([
    ['plain', false],
    ['base64', true],
  ])('413 for a %s body over the limit', async (_, base64) => {
    const store = new MemoryStore();
    const run = vi.spyOn(store, 'run');
    const { send, logs } = setup(store);
    expect(await send(event(oversized, { base64 }))).toEqual({
      statusCode: 413,
    });
    expect(run).not.toHaveBeenCalled();
    expect(logs).toEqual(['bad_request']);
  });

  it('counts bytes, not characters', async () => {
    // 3 bytes per character in UTF-8, so fewer characters than the limit.
    const wide = '☕'.repeat(Math.floor(MAX_BODY_BYTES / 3) + 1);
    const { send } = setup();
    expect(await send(event(wide))).toEqual({ statusCode: 413 });
  });

  it('the secret is checked before the size: a stranger gets 401, not 413', async () => {
    const { send, logs } = setup();
    expect(await send(event(oversized, { headers: {} }))).toEqual({
      statusCode: 401,
    });
    expect(logs).toEqual(['unauthorized']);
  });
});
