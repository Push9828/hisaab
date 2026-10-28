import { interpret } from './interpret';
import { reply } from './reply';
import { type LedgerStore } from './store';
import { type Context, type Result } from './types';

export interface IncomingMessage {
  channel: string;
  /** The channel's message id. With `channel`, the idempotency key. */
  externalId: string;
  text: string;
  now: Date;
}

export type IngestOutcome =
  /** Already handled: write nothing and send no reply. */
  | { status: 'duplicate' }
  | { status: 'ok'; reply: string; kind: Result['kind'] };

/**
 * Interpret one message and apply it. Everything happens in a single store
 * transaction, so a replayed or failed message can never half-write.
 *
 * The outcome carries a reply and a kind, never message text or balances
 * beyond the reply itself, so callers can log `status` and `kind` safely.
 */
export function ingest(
  msg: IncomingMessage,
  store: LedgerStore,
): Promise<IngestOutcome> {
  return store.transaction(async (tx) => {
    if (!(await tx.markProcessed(msg.channel, msg.externalId))) {
      return { status: 'duplicate' };
    }

    const ctx: Context = {
      now: msg.now,
      accounts: await tx.accountsWithBalances(),
    };
    const result = interpret(msg.text, ctx);
    // Built before any write so adjustments report the balance they changed.
    const text = reply(result, ctx);

    switch (result.kind) {
      case 'proposal':
        await tx.insertTransaction(
          {
            channel: msg.channel,
            externalId: msg.externalId,
            rawText: msg.text,
          },
          result.tx,
        );
        return { status: 'ok', reply: text, kind: result.kind };

      case 'open':
        await tx.createAccount({
          alias: result.alias,
          name: result.name,
          kind: result.accountKind,
          openingBalance: result.openingBalance,
        });
        return {
          status: 'ok',
          reply: `${text} Opening an account cannot be undone.`,
          kind: result.kind,
        };

      case 'undo': {
        const target = await tx.lastActive();
        if (!target) {
          return { status: 'ok', reply: 'Nothing to undo.', kind: result.kind };
        }
        await tx.voidTransaction(target.id, msg.now);
        return {
          status: 'ok',
          reply: `Undone: ${target.description}.`,
          kind: result.kind,
        };
      }

      case 'balances':
      case 'matches':
      case 'clarify':
        return { status: 'ok', reply: text, kind: result.kind };
    }
  });
}
