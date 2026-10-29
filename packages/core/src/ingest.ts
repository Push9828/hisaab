import { interpret } from './interpret';
import { reply } from './reply';
import { type LedgerStore } from './store';

export interface IncomingMessage {
  channel: string;
  /** The channel's message id. With `channel` it is the idempotency key. */
  externalId: string;
  text: string;
  now: Date;
}

export interface IngestResult {
  reply: string;
  /** True when this message was already processed. Nothing was written. */
  duplicate: boolean;
}

const DUPLICATE: IngestResult = {
  reply: 'Already processed.',
  duplicate: true,
};

/**
 * One message in, at most one atomic write out. Pure logic stays in
 * `interpret()`; this adds persistence and idempotency around it.
 */
export function ingest(
  message: IncomingMessage,
  store: LedgerStore,
): Promise<IngestResult> {
  const { channel, externalId, text, now } = message;

  return store.run(async (db) => {
    // A replay answers "duplicate" even if the text would now be a clarification.
    if (await db.wasProcessed(channel, externalId)) return DUPLICATE;

    const ctx = { now, accounts: await db.accounts() };
    const result = interpret(text, ctx);

    switch (result.kind) {
      case 'clarify':
      case 'balances':
      case 'matches':
        // Questions and reads write nothing, so they claim nothing and can be retried.
        return { reply: reply(result, ctx), duplicate: false };
    }

    // Claim before writing. Losing the race means another delivery is writing.
    if (!(await db.claim(channel, externalId))) return DUPLICATE;

    switch (result.kind) {
      case 'open':
        await db.createAccount({
          alias: result.alias,
          name: result.name,
          kind: result.accountKind,
          openingBalance: result.openingBalance,
        });
        break;

      case 'proposal':
        await db.insertTransaction(result.tx, {
          channel,
          externalId,
          rawText: text,
        });
        break;

      case 'undo': {
        const voided = await db.voidLatest(now);
        return {
          reply: voided ? `Undone: ${voided.description}.` : 'Nothing to undo.',
          duplicate: false,
        };
      }
    }

    return { reply: reply(result, ctx), duplicate: false };
  });
}
