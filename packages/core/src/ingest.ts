import {
  askCategory,
  fallbackText,
  type Categorizer,
  type CategoryOutcome,
} from './category-fallback';
import { interpret } from './interpret';
import { reply } from './reply';
import { type LedgerStore, type LedgerTxn } from './store';
import { type Context, type Result } from './types';

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
  /** How the LLM fallback went, when it was asked. A label only, never its text. */
  llm?: CategoryOutcome['llm'];
}

const DUPLICATE: IngestResult = {
  reply: 'Already processed.',
  duplicate: true,
};

/** A message that will write. Questions and reads have already been answered. */
interface Prepared {
  ctx: Context;
  result: Extract<Result, { kind: 'open' | 'proposal' | 'undo' }>;
}

async function prepare(
  { channel, externalId, text, now }: IncomingMessage,
  db: LedgerTxn,
): Promise<IngestResult | Prepared> {
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
  return { ctx, result };
}

async function write(
  { channel, externalId, text, now }: IncomingMessage,
  db: LedgerTxn,
  { ctx, result }: Prepared,
): Promise<IngestResult> {
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
}

/** The description of an entry the keyword rules could not settle, or null. */
const missed = ({ result }: Prepared): string | null =>
  result.kind === 'proposal' && result.tx.status === 'NEEDS_REVIEW'
    ? result.tx.description
    : null;

/** Only the category changes. The status stays NEEDS_REVIEW, because nobody confirmed a guess. */
function withOutcome(prepared: Prepared, outcome: CategoryOutcome): Prepared {
  const { result } = prepared;
  return outcome.llm === 'guessed' && result.kind === 'proposal'
    ? {
        ...prepared,
        result: { ...result, tx: { ...result.tx, category: outcome.category } },
      }
    : prepared;
}

/**
 * One message in, at most one atomic write out. Pure logic stays in
 * `interpret()`; this adds persistence and idempotency around it.
 *
 * A keyword miss takes two runs, because the LLM call must not hold the ledger
 * lock: the first writes nothing and the second starts over, so it sees any
 * delivery or account change that landed during the call.
 */
export async function ingest(
  message: IncomingMessage,
  store: LedgerStore,
  categorizer?: Categorizer,
): Promise<IngestResult> {
  const first = await store.run(async (db) => {
    const prepared = await prepare(message, db);
    if ('reply' in prepared) return prepared;
    const description = missed(prepared);
    const text =
      description === null
        ? ''
        : fallbackText(description, prepared.ctx.accounts);
    return categorizer && text !== ''
      ? { categorizer, text }
      : write(message, db, prepared);
  });
  if (!('categorizer' in first)) return first;

  const outcome = await askCategory(first.categorizer, first.text);

  return store.run(async (db) => {
    const prepared = await prepare(message, db);
    if ('reply' in prepared) return prepared;
    const written = await write(message, db, withOutcome(prepared, outcome));
    return { ...written, llm: outcome.llm };
  });
}
