# Hisaab

Personal finance ledger driven by chat messages (WhatsApp test number or Telegram),
with a Next.js dashboard. Single user. Portfolio piece with blog write-ups.

**Source of truth for behaviour: `docs/SPEC.md`.** Read it before any non-trivial task.
If code and spec disagree, stop and ask. Don't silently pick one.

## Stack

TypeScript (strict), Node 22, pnpm workspaces, Drizzle + Postgres, Vitest, fast-check,
AWS Lambda (API Gateway), Next.js (App Router) for the dashboard.

## Layout

```
packages/core        pure logic: money, parser, ledger rules, ingest(). NO I/O imports.
packages/db          Drizzle schema, migrations, stores
apps/adapter         Lambda webhook handler (channel adapter) -> calls core.ingest
apps/dashboard       Next.js, reads from db
docs/                SPEC.md, design notes, blog drafts in docs/blog/
.claude/agents/      sub-agents (see below)
```

`core` must never import from `db`, `adapter`, AWS SDKs, or network libraries.
It receives repositories via interfaces. This keeps it testable and the channel swappable.

## Commands

```
pnpm install
pnpm test            # vitest, all packages
pnpm test:core       # fast loop, no DB
pnpm test:db         # store contract + Postgres tests (needs pnpm --filter @hisaab/db db:up)
pnpm typecheck
pnpm lint
pnpm db:generate     # drizzle-kit generate (after editing schema.ts)
pnpm db:migrate      # local DB (scripts/migrate.ts); prod: pnpm --filter @hisaab/db db:migrate:prod
```

Run `pnpm typecheck && pnpm lint && pnpm test` before declaring any task done.

## Hard rules (non-negotiable)

1. **Money is integer paise (BigInt). Never `number` floats for money.** Parse "4k" to 400000n.
2. **No LLM touches amounts, accounts, or transaction type.** The LLM may only pick a
   category from a fixed list, from free-text description. Everything else is deterministic.
3. **TRANSFER and ADJUSTMENT always have `spendAmount = 0`.** This is what keeps card bill
   payments and internal transfers out of spending reports.
4. **Nothing is hard-deleted.** Undo = void (`voidedAt`). Voided rows are excluded from balances.
5. **Balance is derived** (opening + sum of entries on non-voided transactions). Never store a running balance.
6. **Idempotency**: unique `(channel, externalId)`. Replaying a webhook must be a no-op.
7. **Ambiguous input writes nothing** and replies with a clarifying question.
8. **Secrets never in the repo or logs.** Logs must not contain message bodies or balances.
9. **No real personal data in tests, fixtures, docs, or blog drafts.** Use fake names and numbers.
10. Webhook handlers verify signatures and allowlist the sender before anything else.

## Workflow

- **Spec first, tests first for ledger logic.** The worked examples in SPEC section 5 are
  acceptance tests: write them as tests before the implementation.
- Use property tests (fast-check) for the invariants in SPEC section 4.
- Small commits, one milestone slice at a time. Don't start the next milestone until the
  current one's tests pass.
- For anything touching more than 3 files or any schema change: use the `planner` agent first.
- Before finishing a task: `code-reviewer`. For anything touching the webhook, auth,
  secrets, or the dashboard: also `security-reviewer`.
- Don't add features outside the milestone. Anything in SPEC section 3 (non-goals) needs
  an explicit decision from me, not a judgment call from you.
- If you notice scope creep or over-engineering (generic frameworks, plugin systems,
  abstraction with one implementation), say so and propose the simpler version.

## Sub-agents (`.claude/agents/`)

| Agent | Use when |
|---|---|
| `planner` | Before multi-file or schema work. Produces a plan; writes no code. |
| `code-reviewer` | After implementing. Checks correctness, ledger invariants, tests, simplicity. |
| `security-reviewer` | After touching webhook, auth, secrets, logging, or dashboard data access. |
| `blog-writer` | After a milestone passes. Drafts the matching post from SPEC and real code. |

Four is deliberate. Don't add agents without a concrete recurring need.

## Blog rule

A post in `docs/blog/` is drafted only after its milestone's tests pass
(parser post after M1, LLD after M2, HLD after M3, production post after M4, dashboard post after M5).
Drafts are mine to edit and publish. Use fake data only.

## Decisions log

Record non-obvious decisions in `docs/DECISIONS.md` (date, decision, why). Create it on first use.
  