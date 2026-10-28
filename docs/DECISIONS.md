# Decisions log

## 2026-10-26

**Backdated entries are supported.**
Why: when travelling or otherwise away, entries get missed and need to be logged later.
Detail: an optional date prefix (`yesterday`, `on 20 oct`) sets `occurredAt`. Grammar finalized in M1.
Future dates are rejected as ambiguous (nothing written).

**Omitted account means ask, no default account.**
Why: a silent default risks writing to the wrong account. Hard rule 7 (ambiguous input writes nothing)
already covers this. The bot replies with a clarifying question listing known account aliases.

**Channel is Telegram.**
Why: avoids Meta's test-number token expiry and webhook verification friction. `core` stays
channel-agnostic, so WhatsApp can be added later as another adapter.
Note: Telegram verifies webhooks with the `X-Telegram-Bot-Api-Secret-Token` header
(constant-time compare), not `X-Hub-Signature-256`. Sender allowlist is the numeric Telegram user id.

**Dashboard auth is Better Auth + Google OAuth with an email allowlist.**
Why: no password handling, single user, free. Non-allowlisted Google accounts are rejected at sign-in
and every server-side data read re-checks the session.

## 2026-10-26 (M0 tooling)

**TypeScript pinned to 6.0.3, not 7.**
Why: typescript-eslint 8.72 refuses to load under TS 7.0 (peer range `<6.1.0`). TS 7.0 ships no stable
compiler API; a new one is expected in 7.1. Revisit when typescript-eslint supports TS 7.1+.
No other installed package declares a TS peer range that blocks 7. Our tsconfig already typechecked
under 7.0.2; when upgrading, add `"types": ["node"]` where Node types are needed (TS 7 defaults `types` to `[]`).

**Prisma pinned to 7.10.1 (CLI and client), not `latest`.**
Why: the npm `latest` tag is 8.0.0-rc, a release candidate. Prisma 7 keeps the datasource URL in
`packages/db/prisma.config.ts`, not in `schema.prisma`. M0 schema has no models.

**Prettier plus eslint-plugin-import-x import ordering.**
Why: requested. `import-x/order` groups builtin, external, internal, relative, type, alphabetized,
blank line between groups. Prettier ignores `*.md` and `.claude/` so spec and agent docs are not reflowed.

**ESLint blocks db, adapter, AWS, prisma, network and fs imports inside `packages/core`.**
Why: enforces the "core is pure" layout rule mechanically.

**pnpm build scripts approved only for prisma, @prisma/*, esbuild, unrs-resolver; workerd denied.**
Why: pnpm 12 blocks install scripts by default. workerd arrives transitively via the Prisma CLI and is not needed.

**Vitest root config lists projects explicitly (`packages/core` only for now).**
Why: projects without tests fail startup config. Add each package when it gets tests.

## 2026-10-26 (M1 core)

**`interpret(text, ctx)` is the pure core; `ingest()` (M2) wraps it with persistence and dedupe.**
Why: keeps `core` free of I/O and the ledger rules testable without a database. The caller passes
a snapshot of accounts with derived balances and `now`; there is no Clock or Repository interface
in M1 because nothing has two implementations yet.

**`interpret` builds every transaction through the builders in `ledger.ts`, and each runs `checkInvariants`.**
Why: the property tests then exercise the real construction path, and a rule violation throws
instead of being written. `ProposedTx` is a plain interface, so this is a convention, not enforced
by types; `checkInvariants` has its own negative tests for that reason.

**Time is IST (fixed UTC+5:30), no timezone library.**
Why: IST has no DST. Backdated entries are stamped 12:00 IST on the chosen day. `occurredAt`
is stored as an instant; the dashboard (M5) must group by IST day, not UTC.

**Date prefix: an explicit year is accepted only as 20xx; a year-less date in the future is rejected.**
Why: avoids reading an amount like `4000` as a year, and avoids silently logging to last year.

**Amount cap of 10 crore; fractions must be whole paise.**
Why: catches an extra zero. Nothing is rounded, so paise can never be lost silently.

**Owed kinds (credit card, payable, loan) take stated amounts as "amount owed", stored negative.**
Why: matches how a card statement reads. Banks must be >= 0, so overdrafts are not expressible.

**`got` may exceed the amount owed; the receivable goes negative.**
Why: accepted as an M1 default (overpayment allowed). The code reviewer flagged the negative
receivable; revisit if it causes confusion.

**Uncategorised expenses and splits are still written, with null category and NEEDS_REVIEW; income categories never apply to spending.**
Why: losing the entry is worse than a missing label. Ambiguity about amount, account or type is
different: that writes nothing.

**Open for M2: `undo` and `bal <x> <amount>` must read the last transaction / current balance in
the same DB transaction as the write; undo targets (adjustments, already-voided rows) are decided in the M2 plan.**

## 2026-10-28 (M2 persistence)

**Idempotency uses a `ProcessedMessage(channel, externalId)` unique table, inserted for every write inside the same DB transaction.**
Why: `undo` and `open` create no Transaction row, so the Transaction unique constraint cannot dedupe them and a
replayed `undo` would void a second transaction. Departs from the SPEC section 8 sketch (which only has the
Transaction constraint). The Transaction `(channel, externalId)` unique constraint stays as a second layer.

**A replayed message gets no reply.**
Why: simplest. Known gap: if the first attempt committed but crashed before the adapter replied, the reply is lost.
Revisit by storing the reply text if that ever happens.

**`undo` voids the newest non-voided transaction (ordered by `createdAt`, then `id`, not `occurredAt`). ADJUSTMENT is undoable; `open` is not.**
Why: backdated entries must not change what "last" means. `open` creates an account, not a transaction, and the
reply says it cannot be undone. With nothing to undo the reply is "Nothing to undo" and nothing is written.

**`rawText` is stored in the DB; it is never logged.**
Why: audit trail and the ability to re-parse after a grammar fix. Hard rule 8 restricts logs, not storage.
Possible v2 hardening: null `rawText` after N days. Not built.

**Schema additions over the SPEC section 8 sketch:** indexes on `Entry(accountId)`, `Entry(transactionId)` and
`Transaction(voidedAt, occurredAt)`; `onDelete: Restrict` on Entry relations (nothing is hard-deleted); lowercase
aliases enforced by CHECK; CHECKs `amount <> 0`, `spendAmount >= 0`, and `spendAmount = 0` for TRANSFER and
ADJUSTMENT (hard rule 3, enforced in the database as well as in `checkInvariants`).
