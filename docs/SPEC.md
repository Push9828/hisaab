# Hisaab: Spec (v0.1 draft)

"Hisaab" is Hindi for accounts or reckoning.

## 1. Why

Personal finance visibility. Existing expense apps fail because manual entry is
friction and gets skipped. Logging by chat message ("petrol 4k cc icici") is the
lowest-friction input. A dashboard turns the log into cash-flow visibility.

Secondary goal: a portfolio piece with HLD/LLD write-ups. The public version is
the source code: anyone can run their own single-user copy with their own tokens
and accounts. There is no hosted public instance. Portfolio screenshots use
**seeded fake data only**. Real data never leaves the private deployment.

## 2. Goals (v1)

- Log income, expenses, transfers, split bills, lending and repayments by chat message.
- Multiple accounts: bank accounts, credit cards, receivables (people who owe me).
- Correct handling of credit card spend vs. bill payment, and internal transfers vs. real spend.
- Dashboard: per-account balances, monthly spend by category, net cash flow, money owed to me.
- Undo, and a reconcile command to correct drift against real bank balances.

## 3. Non-goals (v1). Do not build these.

- Multi-user, signup, a hosted public instance, billing.
- Multi-currency. INR only.
- Budgets, goals, forecasting, notifications that the bot initiates.
- Splitwise sync (planned v2, read-only, see section 11).
- Bank statement import (possible v2).
- Principal/interest split of loan EMIs (v2, see known limitations).
- Market value, units, NAV, returns or capital gains for investments.
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
| INVESTMENT | One mutual fund, or a stock holding | positive = money put in minus money taken out, never market value; negative once more has come out than went in |

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

**Monthly reports** cover one calendar month in IST (`occurredAt` in a half-open range) and
exclude voided transactions.

- **Spend by category**: sum of `spendAmount` per category. A null category (`NEEDS_REVIEW`)
  goes in "Uncategorised", so the category total always equals total spend.
- **Cash flow**: in = sum of INCOME entry amounts; out = sum of `spendAmount`; net = in - out.
  ADJUSTMENT amounts are shown as a separate "reconcile corrections" line, outside net.
  - A card spend counts in out when you swipe. It lowers the card balance, not a bank balance.
  - A card bill payment lowers the bank account named in the message and clears the card
    (example 2). It adds nothing to out, because the spend was already counted at the swipe.
  - A SPLIT counts only your share. `lend` and `got` count nothing: the money is still yours.
  - An EMI counts in full (see section 12), and the dashboard says so.
  - Examples 1-8 in section 5 give in 85,000, out 38,000, net 47,000, corrections +800.
- **Savings rate**: net / in for the month, from the cash flow above. It is negative when more went out
  than came in, and blank when there is no income. An EMI counts in full here too, so it understates
  real saving by the principal repaid. Money invested still counts as saved.
- **Invested**: sum of entries on INVESTMENT accounts, from TRANSFER transactions in the month. Negative
  when more came out than went in. Moving money between two funds nets to 0. An opening balance is not a
  transaction, so it is not counted. Invested is its own figure and takes no part in in, out, net or savings rate.
- **People**: by the sign of the balance. "Owes me" lists RECEIVABLE or PAYABLE accounts above zero, and
  "I owe" lists those below zero (a PAYABLE, or an overpaid `got`). Zero balances
  are hidden, and each side has a total.

**Invariants** (these become property tests)
1. Money amounts are positive integers. Direction comes from type and accounts.
2. TRANSFER entries sum to zero.
3. SPLIT: payer entry = -total; receivable entries sum to the others' shares; `spendAmount = total - sum(others' shares)`; own share must be >= 0.
4. Voided transactions are excluded from balances and reports. Nothing is ever hard-deleted.
5. A given (channel, externalMessageId) is processed at most once. This holds for every message that writes anything (transactions, `open`, `undo`), not only those that create a Transaction.
6. Account balance is always derivable from opening balance + entries. No stored running balance.
7. Moving money to, from or between INVESTMENT accounts never changes out, net or savings rate.

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
9. **Buy an investment**: `xfer 10k icici mfalpha`
   TRANSFER. ICICI -10000, MFALPHA +10000. spendAmount 0. Invested +10000. Out and net unchanged.
10. **Sale for more than went in**: with MFALPHA at 10000, `xfer 12k mfalpha icici`
    TRANSFER. MFALPHA -12000, ICICI +12000. spendAmount 0. MFALPHA is now -2000, with no warning.
    Invested -12000. In, out and net unchanged: the 2000 gain is not income.
11. **Fund to fund**: `xfer 5k mfalpha mfbeta`
    TRANSFER. MFALPHA -5000, MFBETA +5000. spendAmount 0. Invested +0.
12. **Investment reconcile refused**: `bal mfalpha 15000` (or any amount, including 0) replies with a
    clarifying question and writes nothing. `bal mfalpha` alone still shows the balance.

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
open <alias> <amount> <kind>                       kinds: bank cc receivable payable loan investment
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
  receive time (for Telegram, `message.date`: when Telegram received it). Time is IST (UTC+5:30, fixed).
- Credit cards, payables and loans: a stated amount (`open`, `bal`) means the amount owed and
  is stored as a negative balance. A stated bank balance cannot be negative, but spending and
  transfers can still overdraw a bank account.
- Investments: the amount in `open` is money already put in, stored positive. `bal <investment> <amount>`
  is always refused, because a statement states market value and the balance is not that. `xfer` is the only
  way money moves in or out: expense, `in`, `emi`, `pay`, `lend`, `got` and `split` refuse an investment account.
- `xfer` works between BANK, CREDIT_CARD, LOAN and INVESTMENT accounts (so `xfer` to a card also works as a
  bill payment). Use `lend` and `got` for people. PAYABLE accounts exist only via `open` for now.
- Account kind words for `open`: `bank`, `cc` (or `credit_card`), `receivable`, `payable`, `loan`, `investment`.
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
        |  verify secret token, allowlist sender, build key (chat.id:message_id)
        v
packages/core: ingest(message, store) -> dedupe (claim key) -> parse -> validate -> ledger write
        |                                                        |
        |                                                        +--> categorizer (rules, LLM fallback)
        v
Postgres (Supabase free tier, Mumbai ap-south-1) via Drizzle
        ^
        |  server-side reads
Next.js dashboard (Better Auth + Google OAuth, email allowlist)
```

Key decision: **`core` is pure and channel-agnostic.** Telegram is a
thin adapter, so the channel can be swapped without touching ledger logic.

Later: EventBridge -> Lambda for recurring rules (rent, SIP, monthly transfer) and
for Splitwise polling.

## 8. Data model sketch

Illustrative and tool-neutral. The real schema, including the CHECK constraints, is
`packages/db/src/schema.ts`; ids are generated UUID text and timestamps are `timestamptz`.

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
  seq          Int      @unique @default(autoincrement()) // identity; creation order; `undo` voids the highest non-voided seq

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

enum AccountKind { BANK CREDIT_CARD RECEIVABLE PAYABLE LOAN INVESTMENT }
enum TxType { INCOME EXPENSE TRANSFER SPLIT ADJUSTMENT }
enum TxStatus { CONFIRMED NEEDS_REVIEW }
```

Where the sketch and `schema.ts` differ (UUID text ids, `timestamptz`, the CHECK constraints,
identity `seq`), `schema.ts` is the truth.

## 9. Security (non-negotiable even for a personal tool)

- Verify the webhook secret (Telegram: `X-Telegram-Bot-Api-Secret-Token`, constant-time compare). Reject on mismatch.
- Allowlist the sender id. Ignore everything else silently.
- Idempotency via the `ProcessedMessage` primary key (channel, externalId), with the unique on `Transaction` as a backstop. Channels retry.
- Secrets in environment or AWS Secrets Manager. Never in the repo. `.env` is gitignored.
- Dashboard requires auth. It is financial data on a public URL.
- Every dashboard read checks the session and the email allowlist on the server. Middleware is not the security boundary.
- The dashboard is server-rendered and read-only: no data API routes, no financial JSON sent to browser code, responses are `no-store`.
- The dashboard connects as its own database role, which cannot write to the ledger and cannot read `rawText` or `ProcessedMessage`. It reads and writes only `better_auth` for sign-in.
- Production secrets are set for Vercel's Production environment only, so a preview deployment cannot reach real data.
- Logs must not contain full message bodies or balances.
- The webhook secret lives in AWS Secrets Manager in production and in the gitignored `.env` locally.
- The bot token is never given to the Lambda: replies go back in the webhook response, so only the
  `set-webhook` script on the laptop uses it, from the gitignored `.env`. Rotate via BotFather if leaked.

## 10. Milestones (target dates are proposals: edit them)

| # | Deliverable | Target |
|---|---|---|
| M0 | Repo scaffold, lint, test runner, CI | Oct 25 |
| M1 | `core`: money type, parser, ledger rules, **all section 5 examples as passing tests**. No I/O | Oct 26 |
| M2 | DB schema, `ingest()` with persistence, idempotency, undo, bal/reconcile | Nov 1 |
| M3 | Channel adapter running locally behind a tunnel, end-to-end from the real chat app | Nov 2 |
| M4 | Deploy Lambda behind API Gateway, secrets in Secrets Manager, webhook moved off the tunnel | Nov 8 |
| M5 | Dashboard: balances, monthly spend by category, cash flow, owed-to-me | Nov 9 |
| M5.1 | Investment accounts: `INVESTMENT` kind, section 5 examples 9-12, "Invested" on the dashboard | next |
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
- **Investment balances are not what the holding is worth.** They are money in minus money out, so a balance
  says nothing about gain or loss, a sale for more than went in turns it negative, and gains and dividends never appear
  as income. Dividends paid to a bank account can be logged with `in`, which does count as income.
  `bal` cannot correct these accounts: an older mistake is corrected with an opposite `xfer`, which also changes
  Invested in the month it is logged, so the month of the mistake stays wrong.
- **A wrong opening balance on an investment account is awkward to fix.** `open` is not undoable and `bal` is refused.
  To correct it, `xfer` the difference against a bank account, then `bal <bank> <real balance>` to put the bank back.
  That leaves a false figure in that month's Invested and a reconcile correction on the bank. Check the amount before
  sending `open`. A proper correction command would be a grammar change, not yet decided.
- **Correcting older transactions**: `NEEDS_REVIEW` rows cannot be given a category, and `undo` only voids the
  latest transaction. Deferred until after M5; see DECISIONS.md (2026-11-01).
- Backdated entries: DECIDED, supported via `yesterday` / `on 20 oct` prefix. Exact grammar in M1. See DECISIONS.md.
- Omitted account: DECIDED, reply with a clarifying question, write nothing.
- Category list: DECIDED, fixed list in section 6. Add keywords as real use shows gaps.
- Dashboard auth: DECIDED, Better Auth + Google OAuth with email allowlist.
- Channel: DECIDED, Telegram (secret-token header instead of `X-Hub-Signature-256`). WhatsApp optional later.
