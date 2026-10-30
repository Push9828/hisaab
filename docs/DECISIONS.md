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

**Prisma pinned to 7.10.1 (CLI and client), not `latest`.** *(Superseded 2026-10-29: Prisma was replaced by Drizzle.)*
Why: the npm `latest` tag is 8.0.0-rc, a release candidate. Prisma 7 keeps the datasource URL in
`packages/db/prisma.config.ts`, not in `schema.prisma`. M0 schema has no models.

**Prettier plus eslint-plugin-import-x import ordering.**
Why: requested. `import-x/order` groups builtin, external, internal, relative, type, alphabetized,
blank line between groups. Prettier ignores `*.md` and `.claude/` so spec and agent docs are not reflowed.

**ESLint blocks db, adapter, AWS, prisma, network and fs imports inside `packages/core`.**
Why: enforces the "core is pure" layout rule mechanically.

**pnpm build scripts approved only for prisma, @prisma/*, esbuild, unrs-resolver; workerd denied.** *(Now esbuild and unrs-resolver only.)*
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

**Resolved in M2 (see below): `undo` and `bal <x> <amount>` must read the last transaction / current balance in
the same DB transaction as the write; undo targets (adjustments, already-voided rows) are decided in the M2 plan.**

## 2026-10-28 (M2 plan)

**M2 starts clean; the reverted M2a/M2b commits are not reused.**
Why: chosen by the author to rebuild with full understanding, one reviewed step at a time (see `docs/M2-PLAN.md`).

**Idempotency uses a `ProcessedMessage(channel, externalId)` table, claimed before any write.**
Why: `undo`, `open` and reconcile create no Transaction row, so the unique on `Transaction` cannot
dedupe them, and a replayed `undo` would void a second transaction (hard rule 6). SPEC section 8 and
invariant 5 updated. The unique on `Transaction` stays as a backstop. Clarifications and read-only
replies claim nothing, so a clarified message can be retried with the same id.

**A replayed message is a no-op that returns `duplicate: true`.**
Why: the adapter decides whether to reply. `core` does not try to reproduce the original reply.

**`undo` voids the latest non-voided transaction in creation order, adjustments included. `open` is not undoable.**
Why: simplest rule that matches "void the last transaction". Repeated undo walks backwards. Accounts
are not transactions. Nothing to void replies "Nothing to undo." and writes nothing.

**`ingest` talks to storage only through `LedgerStore.run(fn)`, one atomic unit per message.**
Why: keeps `core` free of `db` imports and satisfies "read and write in the same DB transaction".
`MemoryStore` (tests) and `DrizzleStore` (production; it was `PrismaStore` until 2026-10-29) share one contract test suite.

## 2026-10-29 (M2 step 5)

**`Transaction.seq` (autoincrement, unique) defines creation order; `undo` voids the highest non-voided `seq`.**
Why: `createdAt DEFAULT now()` is fixed for a whole Postgres transaction and cuids are not ordered, so
"latest" could tie. `seq` matches `MemoryStore`'s insertion order exactly. SPEC section 8 updated.

**Hand-written CHECKs in the init migration: `spendAmount >= 0`, `spendAmount = 0` for TRANSFER, ADJUSTMENT and INCOME, `Entry.amount <> 0`.**
Why: a second line of defence for hard rule 3. Cross-row rules (transfer sums, split arithmetic) stay in
`checkInvariants` and the property tests, since DB triggers for them would be over-engineering.

**Entry foreign keys are `onDelete: Restrict`.** Why: nothing is hard-deleted (hard rule 4).

**Resolved in step 6: every `run()` takes a Postgres advisory lock first, matching `MemoryStore`'s queue, so two undos cannot pick the same row.**

## 2026-10-29 (M2: Prisma replaced by Drizzle)

**Prisma 7.10.1 is replaced by Drizzle (`drizzle-orm` 0.45.4, `drizzle-kit` 0.31.11, pinned exactly). The 1.0 release candidate is skipped.**
Why: no generated client folder (a fresh clone could not typecheck), CHECK constraints live in the
schema instead of hand-edited migration SQL, and our hot paths (advisory lock, grouped sum,
`ON CONFLICT DO NOTHING`) are SQL-shaped. We use almost none of the 1.0 surface, so the release
candidate buys nothing. Revisit at 1.0 stable. This supersedes the Prisma pin and the "hand-written
CHECKs in the init migration" decision above; the CHECKs keep their names and now live in `schema.ts`.
`LedgerStore` and its shared contract suite did not change, which is what made the swap cheap.

**Ids are `crypto.randomUUID()` text, and timestamps are `timestamptz`.**
Why: no new dependency for ids. A bare `timestamp` is read in the process timezone by `pg`, which
would differ between a laptop and Lambda. `occurredAt` is an instant. Nothing was deployed, so the
change was free. Account list order stays `createdAt`, then `id`: each `open` is its own transaction
under the run lock, so ties do not happen in practice.

**Pool `statement_timeout` is 30s. Drizzle has no per-transaction timeout.**
Why: time spent waiting on the advisory lock must not be cut off by a short default, but a stuck
statement should not block forever.

**Never enable Drizzle's `logger` option.** Why: it prints query parameters, which include message
bodies (hard rule 8).

**M3: the adapter must handle a lost reply on a replayed id.**
Why: if a delivery commits but the reply to the user is lost, the retry returns `duplicate: true`
and `core` does not reproduce the original reply. The adapter decides what to tell the user, for
example a short "already processed" message, rather than staying silent.

**Local databases from the Prisma era must be dropped** (`db:down -v`, and `DROP DATABASE hisaab_test`)
because they hold Prisma's migration table. They held no real data.

## 2026-10-29 (M2 complete)

**M2 is done: `ingest()` with persistence, idempotency, undo and reconcile, on `MemoryStore` and Postgres (`DrizzleStore`).**
Why recorded: the temporary step plan (`docs/M2-PLAN.md`) is deleted; the decisions it carried are in the
entries above. Both stores pass one shared contract suite, and the SPEC section 5 examples run end to end.
Open for M3: the adapter's handling of a lost reply on a replayed id (see above).

## 2026-10-30 (M3 plan)

**The Telegram adapter replies in the webhook response body (`{method: 'sendMessage', chat_id, text}`), not with an outbound `sendMessage` call.**
Why: the handler then needs no bot token and no HTTP client; only the `set-webhook` script uses the token.
This closes the M2 open item: if our response is lost, Telegram retries, `ingest` returns `duplicate: true`,
and the user gets "Already processed." Telegram does not report a failed delivery of a reply it has accepted;
an outbound call that ignores errors has the same gap, so this is accepted.

**`externalId` is `${chat.id}:${message_id}`, not `update_id`.**
Why: Telegram may restart `update_id` numbering at random after a week without updates, so it is not a stable key.
This must not change after the first real write, or dedupe breaks.

**`now` for a Telegram message is `message.date` (when Telegram received it), not our server clock.**
Why: it stays the same across retries, and a late delivery still gets the right "today" and "yesterday". SPEC section 6 updated.

**The webhook secret is verified from M3, not M4.** SPEC M4 row reworded.
Why: the tunnel URL is public, and hard rule 10 applies from the first request. The adapter refuses to start if
the secret is empty or not 1-256 chars of `[A-Za-z0-9_-]`, or if the allowed user id is missing. Both sides are
SHA-256 hashed before `timingSafeEqual`, which throws on unequal lengths.

**Any error thrown while processing (store failure, or a bug such as a failed invariant check) is logged as `error` and replies 200 "Something went wrong, nothing was saved. Try again." instead of returning 500.**
Why: the DB transaction rolls back, so nothing is half-written and resending is safe. A 500 makes Telegram retry
a message that may fail every time, for hours, holding up later messages.

**Ignored silently (200, no reply, no write): wrong sender, non-private chat, `edited_message`, non-text, malformed JSON.**
Edits are also excluded by `allowed_updates: ["message"]`. `/start` gets the normal unknown-command clarification.

**Adapter logs are fixed labels only, never an error object.** Why: Drizzle and pg errors carry query
parameters, which include `rawText` (hard rule 8).

**The adapter runs TypeScript with `tsx` 4.23.15 (pinned).** Why: Node's built-in type stripping needs file
extensions in imports, and the workspace uses extensionless imports. `tsx --env-file` also means no dotenv.
