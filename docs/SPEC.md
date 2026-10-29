# Hisaab: Spec (v0.1 draft)

"Hisaab" is Hindi for accounts or reckoning.

## 1. Why

Personal finance visibility. Existing expense apps fail because manual entry is
friction and gets skipped. Logging by chat message ("petrol 4k cc icici") is the
lowest-friction input. A dashboard turns the log into cash-flow visibility.

Secondary goal: a portfolio piece with HLD/LLD write-ups. The public version
uses **seeded fake data only**. Real data never leaves the private deployment.

## 2. Goals (v1)

- Log income, expenses, transfers, split bills, lending and repayments by chat message.
- Multiple accounts: bank accounts, credit cards, receivables (people who owe me).
- Correct handling of credit card spend vs. bill payment, and internal transfers vs. real spend.
- Dashboard: per-account balances, monthly spend by category, net cash flow, money owed to me.
- Undo, and a reconcile command to correct drift against real bank balances.

## 3. Non-goals (v1). Do not build these.

- Multi-user, signup, public hosting, billing.
- Multi-currency. INR only.
- Budgets, goals, forecasting, notifications that the bot initiates.
- Splitwise sync (planned v2, read-only, see section 11).
- Bank statement import (possible v2).
- Principal/interest split of loan EMIs (v2, see known limitations).
- Any LLM involvement in amounts, accounts, or transaction type.

## 4. Domain model

**Money**: integer paise, stored as BigInt. Never floats. Parse "4k" = 400000 paise.
INR only.

**Account kinds**

| Kind | Meaning | Balance sign |
|---|---|---|
| BANK | Savings/current account | positive = money I have |
| CREDIT_CARD | Card account | negative = amount I owe the card |
| RECEIVABLE | A person who owes me (e.g. Rahul) | positive = they owe me |
| PAYABLE | A person I owe | negative = I owe them |
| LOAN | Optional, tracks loan liability | negative = outstanding |

Balance = openingBalance + sum(entries) on non-voided transactions.

**Transaction types**

| Type | Moves money | Counts as spending? |
|---|---|---|
| INCOME | into one account from outside | no |
| EXPENSE | out of one account to outside | yes, full amount |
| TRANSFER | between two of my accounts | **never** |
| SPLIT | out of one account; part is my spend, rest becomes receivables | only my own share |
| ADJUSTMENT | reconcile correction on one account | no |

The spending report sums `spendAmount` on non-voided transactions. Transfers and
adjustments always have `spendAmount = 0`. This single rule is what keeps credit
card bill payments and internal transfers out of spending.

**Invariants** (these become property tests)
1. Money amounts are positive integers. Direction comes from type and accounts.
2. TRANSFER entries sum to zero.
3. SPLIT: payer entry = -total; receivable entries sum to the others' shares; `spendAmount = total - sum(others' shares)`; own share must be >= 0.
4. Voided transactions are excluded from balances and reports. Nothing is ever hard-deleted.
5. A given (channel, externalMessageId) is processed at most once. This holds for every message that writes anything (transactions, `open`, `undo`), not only those that create a Transaction.
6. Account balance is always derivable from opening balance + entries. No stored running balance.

## 5. Worked examples (acceptance tests)

Amounts in rupees for readability. Real values are paise.

1. **Credit card spend**: `petrol 4k cc icici`
   EXPENSE. Entry: ICICI-CC -4000. spendAmount 4000. Category Transport.
   Bank balance unchanged.
2. **Credit card bill payment**: `pay icicicc 4k from icici`
   TRANSFER. Entries: ICICI-BANK -4000, ICICI-CC +4000. spendAmount 0.
   Bank shows one transaction. Card history is intact. Spending is not double counted.
3. **Internal transfer**: `xfer 25k icici bom`
   TRANSFER. ICICI -25000, BOM +25000. spendAmount 0.
4. **Home loan EMI**: `emi 32k bom`
   EXPENSE. Entry: BOM -32000. spendAmount 32000. Category "Home loan EMI".
   Counted once, because example 3 was a transfer and counts as nothing.
5. **Lend money**: `lend rahul 10k icici`
   TRANSFER. ICICI -10000, RAHUL(receivable) +10000. spendAmount 0.
   Repayment: `got rahul 5k icici` is TRANSFER RAHUL -5000, ICICI +5000.
6. **Split bill**: `dinner 4000 split rahul 1000 anita 1000 cc icici`
   SPLIT. ICICI-CC -4000, RAHUL +1000, ANITA +1000. spendAmount 2000 (remainder is my share).
7. **Income**: `in 85k salary icici` is INCOME. ICICI +85000.
8. **Reconcile**: `bal icici 85000` when the ledger says 84200 creates an
   ADJUSTMENT of +800 and replies with the difference.

## 6. Message grammar (final, M1)

Deterministic, tokenized, case-insensitive. No LLM. Implemented in `packages/core`.

```
[<date>] <desc...> <amount> <account>              expense
[<date>] in <amount> <desc...> <account>           income
[<date>] xfer <amount> <from> <to>                 transfer
[<date>] pay <card> <amount> from <bank>           card bill payment (transfer)
[<date>] emi <amount> <account>                    expense, category "Home loan EMI"
[<date>] lend <person> <amount> <account>          transfer to receivable
[<date>] got <person> <amount> <account>           repayment from receivable
[<date>] <desc...> <amount> split <p1> <a1> [<p2> <a2> ...] <account>
open <alias> <amount> <kind>                       kinds: bank cc receivable payable loan
bal [<account>] [<amount>]                         show balance, or reconcile to stated amount
accounts                                           list accounts and balances
undo                                               void the latest non-voided transaction (adjustments included; `open` is not undoable)
```

- At the end of an expense, `in`, `emi`, `lend`, `got` or `split`, the account is one alias or
  `cc <x>` meaning the alias `<x>cc` (`cc icici` is `icicicc`). `xfer`, `pay` and `bal` take plain
  aliases only (`xfer 5k icici icicicc`).
- The first token is the command. Command words always win; there is no escape prefix.
- Amount forms: `450`, `4k`, `1.5k`, `1.25k`, `1.2l` / `1.2L` (lakh), `450.50`. Must be a
  whole number of paise, at most 10 crore, and greater than zero, except the opening balance in
  `open` and the stated amount in `bal`, which may be 0. `1,200` and `₹500` are rejected.
- Date prefix (entries only; not on `open`, `bal`, `accounts`, `undo`): `today`, `yesterday`,
  `on 20 oct`, `on 20 oct 2025`. Month names are 3-letter or full. The year defaults to the
  current IST year; a date in the future is rejected, never rolled back a year. An explicit
  year must be 20xx. Backdated entries are stamped 12:00 IST; undated entries use the
  receive time. Time is IST (UTC+5:30, fixed).
- Credit cards, payables and loans: a stated amount (`open`, `bal`) means the amount owed and
  is stored as a negative balance. A stated bank balance cannot be negative, but spending and
  transfers can still overdraw a bank account.
- `xfer` works between BANK, CREDIT_CARD and LOAN accounts (so `xfer` to a card also works as a
  bill payment). Use `lend` and `got` for people. PAYABLE accounts exist only via `open` for now.
- Account kind words for `open`: `bank`, `cc` (or `credit_card`), `receivable`, `payable`, `loan`.
- `got` may exceed what the person owes; the receivable then goes negative. No warning in v1.
- `lend`, `got` and `split` people must exist as RECEIVABLE accounts (`open sam 0 receivable`).
  Split: own share may be zero; each person once, non-zero; shares may not exceed the total.
- `bal` alone is the same as `accounts`. `bal <amount>` without an account is a question.
- Anything ambiguous returns a clarifying question and writes **nothing**: unknown command,
  missing or unknown account, missing description, more than one amount, bad amount, bad or
  future date, wrong account kind, same account twice, bad split, duplicate or reserved alias.
- Unrecognised category (expenses and splits): keyword rules only in M1. No match, keywords from
  two categories, or an income category such as "salary advance", stores the transaction with a
  null category and status `NEEDS_REVIEW`. Income is `Salary` on a salary keyword, else `Other income`.

Reply on every successful write, e.g. `Logged: 4,000 Petrol (Transport) on ICICI-CC. Reply "undo" to revert.`

**Categories** (fixed): Food, Groceries, Transport, Rent, Utilities, Shopping, Entertainment,
Health, Travel, Subscriptions, Home loan EMI, Salary, Other income. Keyword rules first; the
LLM fallback may only choose from this list given the free-text description. It never sees or
alters amounts, accounts, or type.

## 7. Architecture (HLD)

```
Telegram bot
        |  webhook (HTTPS)
        v
API Gateway -> Lambda: channel adapter
        |  verify signature, allowlist sender, dedupe by message id
        v
packages/core: ingest(text, sender) -> parse -> validate -> ledger write
        |                                   |
        |                                   +--> categorizer (rules, LLM fallback)
        v
Postgres (Neon or Supabase free tier) via Prisma
        ^
        |  server-side reads
Next.js dashboard (Better Auth + Google OAuth, email allowlist)
```

Key decision: **`core` is pure and channel-agnostic.** Telegram is a
thin adapter, so the channel can be swapped without touching ledger logic.

Later: EventBridge -> Lambda for recurring rules (rent, SIP, monthly transfer) and
for Splitwise polling.

## 8. Data model sketch (Prisma)

```prisma
model Account {
  id             String   @id @default(cuid())
  alias          String   @unique   // "icici", "icicicc", "bom", "rahul"
  name           String
  kind           AccountKind
  openingBalance BigInt   @default(0)
  entries        Entry[]
  createdAt      DateTime @default(now())
}

model Transaction {
  id           String   @id @default(cuid())
  type         TxType
  occurredAt   DateTime
  description  String
  category     String?
  spendAmount  BigInt   @default(0)   // my real spending; 0 for transfers/income/adjustments
  status       TxStatus @default(CONFIRMED) // CONFIRMED | NEEDS_REVIEW
  voidedAt     DateTime?
  channel      String
  externalId   String              // message id from the channel
  rawText      String
  entries      Entry[]
  createdAt    DateTime @default(now())
  seq          Int      @unique @default(autoincrement()) // creation order; `undo` voids the highest non-voided seq

  @@unique([channel, externalId])
}

model Entry {
  id            String      @id @default(cuid())
  transactionId String
  accountId     String
  amount        BigInt      // signed paise, negative = leaves account
  transaction   Transaction @relation(fields: [transactionId], references: [id], onDelete: Restrict)
  account       Account     @relation(fields: [accountId], references: [id], onDelete: Restrict)

  @@index([accountId])     // balance = grouped sum over this
  @@index([transactionId])
}

// One row per processed message that wrote something. Claimed before the write,
// in the same DB transaction. Covers `undo` and `open`, which create no Transaction.
model ProcessedMessage {
  channel    String
  externalId String
  createdAt  DateTime @default(now())

  @@id([channel, externalId])
}

enum AccountKind { BANK CREDIT_CARD RECEIVABLE PAYABLE LOAN }
enum TxType { INCOME EXPENSE TRANSFER SPLIT ADJUSTMENT }
enum TxStatus { CONFIRMED NEEDS_REVIEW }
```

## 9. Security (non-negotiable even for a personal tool)

- Verify the webhook secret (Telegram: `X-Telegram-Bot-Api-Secret-Token`, constant-time compare). Reject on mismatch.
- Allowlist the sender id. Ignore everything else silently.
- Idempotency via the `ProcessedMessage` primary key (channel, externalId), with the unique on `Transaction` as a backstop. Channels retry.
- Secrets in environment or AWS Secrets Manager. Never in the repo. `.env` is gitignored.
- Dashboard requires auth. It is financial data on a public URL.
- Logs must not contain full message bodies or balances.
- Bot token and webhook secret live in AWS Secrets Manager or environment. Rotate via BotFather if leaked.

## 10. Milestones (target dates are proposals: edit them)

| # | Deliverable | Target |
|---|---|---|
| M0 | Repo scaffold, lint, test runner, CI | Oct 25 |
| M1 | `core`: money type, parser, ledger rules, **all section 5 examples as passing tests**. No I/O | Oct 26 |
| M2 | Prisma schema, `ingest()` with persistence, idempotency, undo, bal/reconcile | Nov 1 |
| M3 | Channel adapter running locally behind a tunnel, end-to-end from the real chat app | Nov 2 |
| M4 | Deploy Lambda, permanent token, signature verification | Nov 8 |
| M5 | Dashboard: balances, monthly spend by category, cash flow, owed-to-me | Nov 9 |
| M6 | Recurring rules via EventBridge | later |
| M7 | Splitwise read-only sync (flat expenses) | later |

Blog rule: a post is published only after its milestone's tests pass.
HLD post after M3, LLD post after M2, parser post after M1, production post after M4.

## 11. Splitwise (v2, read-only)

No evidence of real-time webhooks. Poll `get_expenses` with `updated_at` via
EventBridge. Do **not** import Splitwise expenses as ledger entries; that
double counts what the bank already shows. Import per-friend net balances and
use them to reconcile against the RECEIVABLE/PAYABLE accounts. Personal API key
is enough.

## 12. Known limitations and open questions

- **EMI as an expense** overstates spending relative to economics and leaves loan
  balance and net worth stale. Fix in v2 by splitting principal (transfer to LOAN
  account) from interest (expense).
- Backdated entries: DECIDED, supported via `yesterday` / `on 20 oct` prefix. Exact grammar in M1. See DECISIONS.md.
- Omitted account: DECIDED, reply with a clarifying question, write nothing.
- Category list: DECIDED, fixed list in section 6. Add keywords as real use shows gaps.
- Dashboard auth: DECIDED, Better Auth + Google OAuth with email allowlist.
- Channel: DECIDED, Telegram (secret-token header instead of `X-Hub-Signature-256`). WhatsApp optional later.
