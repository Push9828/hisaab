# M2 step-by-step plan (temporary)

Temporary working doc. Delete it when M2 is done.

## How we work through this

1. I do one step only, then stop and explain what changed and why.
2. You ask questions. Nothing moves until you are satisfied.
3. You say "commit" and I commit that step (one commit per step).
4. You say "next" and I start the following step.
5. No code changes happen without your go-ahead on that step.

## Decisions already made

- Start clean. The reverted M2a/M2b commits (`06ddc56`, `110f9a8`) are not reused.
- Undo voids the latest non-voided transaction by creation order, adjustments included.
  `open` is not undoable because accounts are not transactions.
- Idempotency uses a new `ProcessedMessage(channel, externalId)` table, claimed before any write.
  This deviates from SPEC section 8, which only puts the unique key on `Transaction`.
  The reason is that `undo`, `open` and reconcile create no Transaction row to hold the key,
  so a replayed `undo` would void a second transaction. The spec must be updated (step 1).
- A replayed message returns `{ duplicate: true }` and a no-op. The adapter can choose not to reply.

## Steps

### Step 1: Record the decisions (docs only)
- **Change:** `docs/DECISIONS.md` (undo semantics, ProcessedMessage, store shape), `docs/SPEC.md` section 8 (add the model) and invariant 5 wording.
- **Why:** CLAUDE.md says code and spec must not silently disagree. The spec changes first, then the code follows.
- **Check:** read the diff. No code touched.

### Step 2: `LedgerStore` interface and `MemoryStore`
- **Change:** new `packages/core/src/store.ts`, `memory-store.ts`, and a small `memory-store.test.ts`.
- **What:** one interface, `run(fn)`, which hands `fn` a transaction handle with `wasProcessed`, `claim`, `accounts`, `createAccount`, `insertTransaction`, `voidLatest`.
  `MemoryStore` is a test double that serialises runs and rolls back if `fn` throws.
- **Why:** `core` must not import `db`. It talks to storage only through this interface, which is what lets us test the ledger rules without Postgres. One `run()` per message gives us atomicity ("same DB transaction", from DECISIONS).
- **Check:** `pnpm test:core`. The rollback and serialisation tests pass.

### Step 3: `ingest()`, driven by the example tests
- **Change:** `packages/core/src/ingest.ts`, export from `index.ts`. The test file `ingest.test.ts` is already drafted (uncommitted); we review it together first.
- **What:** `ingest({channel, externalId, text, now}, store)`: check replay, read accounts, call the existing pure `interpret()`, claim the message, write, reply.
  Clarify and read-only results write nothing and never claim the id.
- **Why:** this is the one place persistence meets the pure logic. SPEC section 5 examples 1–8 become end-to-end acceptance tests.
- **Check:** `pnpm test:core` passes, including replay, concurrent delivery, undo, clarify-writes-nothing.

### Step 4: Property tests through `ingest`
- **Change:** extend `invariants.property.test.ts`.
- **What:** random message sequences with random undos and replays. Balance always equals opening plus non-voided entries. Spend excludes voided rows. Replaying N times gives the same final state.
- **Why:** SPEC invariants 4, 5 and 6 are about the system over time, which example tests cannot cover.
- **Check:** `pnpm test:core`.

### Step 5: Prisma schema and migration
- **Change:** `packages/db/prisma/schema.prisma`, a generated migration, hand-added CHECK constraints in the migration SQL, local Postgres setup notes.
- **What:** the SPEC section 8 models plus `ProcessedMessage`, and indexes on `Entry.accountId` and `Entry.transactionId`. CHECKs: `spendAmount >= 0`, `Entry.amount <> 0`, `spendAmount = 0` for TRANSFER, ADJUSTMENT and INCOME.
- **Why:** this is a schema change. The CHECKs are a second line of defence for hard rule 3 that Prisma cannot express.
- **Check:** `pnpm db:migrate` applies cleanly on a fresh database. This step needs a local Postgres.

### Step 6: `PrismaStore`
- **Change:** `packages/db/src/prisma-store.ts`, export from `packages/db/src/index.ts`.
- **What:** implements `LedgerStore` on `prisma.$transaction`. Balances are a grouped sum of non-voided entries plus the opening balance. `claim` is an insert that ignores duplicates. BigInt end to end.
- **Why:** this is the production implementation of the interface from step 2.
- **Check:** typecheck. Tests come in step 7.

### Step 7: Shared contract tests and the db test project
- **Change:** a shared store test suite, run against both `MemoryStore` and `PrismaStore`. Add the db project to the root vitest config and a `test:db` script.
- **What:** the step 3 behaviours on both stores, plus a concurrent same-id race, CHECK rejections, and amounts above 2^53 to prove no `number` coercion.
- **Why:** two real implementations of one interface is what justifies the interface. The contract suite stops them drifting apart.
- **Check:** `pnpm test:db` against local Postgres.

### Step 8: Wrap up
- **Change:** final `DECISIONS.md` entries, delete this file.
- **What:** `pnpm typecheck && pnpm lint && pnpm test`, then the `code-reviewer` agent. `security-reviewer` is not needed because M2 touches no webhook, auth or secrets. Then M2 is done and the LLD blog post may be drafted.
- **Check:** all green, review findings addressed.

## Not doing in M2

No Clock interface, no per-entity repositories, no event bus, no User table, no Prisma mock, no webhook or adapter work (that is M3).
