# Hisaab: Spec (v0.1 draft)

"Hisaab" is Hindi for accounts or reckoning.

## 1. Why

Personal finance visibility. Existing expense apps fail because manual entry is
friction and gets skipped. Logging by chat message ("petrol 4k cc icici") is the
lowest-friction input. A dashboard turns the log into cash-flow visibility.

Secondary goal: a portfolio piece with HLD/LLD write-ups. The public version is
the source code: anyone can run their own single-user copy with their own tokens
and accounts. There is no hosted public instance. Portfolio screenshots use
**seeded fake data only**. Real data stays in the private deployment, with one exception: from M5.2,
free-text descriptions, and from M5.4 the text of `ask` questions, go to the chosen LLM provider (section 9).

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
| RECEIVABLE | A person who owes me (e.g. John) | positive = they owe me |
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

- **Spend by category**: sum of `spendAmount` per category. A null category goes in "Uncategorised",
  so the category total always equals total spend. A guessed category (section 6) counts under that
  category, and the dashboard does not mark it as a guess.
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
5. **Lend money**: `lend john 10k icici`
   TRANSFER. ICICI -10000, JOHN(receivable) +10000. spendAmount 0.
   Repayment: `got john 5k icici` is TRANSFER JOHN -5000, ICICI +5000.
6. **Split bill**: `dinner 4000 split john 1000 sam 1000 cc icici`
   SPLIT. ICICI-CC -4000, JOHN +1000, SAM +1000. spendAmount 2000 (remainder is my share).
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

Category fallback: the LLM's answer is given in each example, and only the category can differ from a run with no LLM.

13. **Guess**: `chai 20 icici`, LLM answers Food. EXPENSE. ICICI -20. spendAmount 20. Category Food, status `NEEDS_REVIEW`.
    Reply: `Logged: 20 Chai (Food, guessed) on ICICI. Reply "undo" to revert.`
14. **Guess on a split**: `momos 900 split john 300 icici`, LLM answers Food. SPLIT. ICICI -900, JOHN +300.
    spendAmount 600. Category Food, status `NEEDS_REVIEW`.
15. **No usable answer**: `asdf 100 icici`, LLM answers `unsure`, answers something off the list, or fails. EXPENSE.
    ICICI -100. spendAmount 100. Null category, status `NEEDS_REVIEW`. Reply says the category needs review.
16. **Nothing to send**: `john 500 icici` when `john` is an account. No call. Stored as in example 15.
17. **Keyword hit**: example 1 makes no call, and stays Transport and `CONFIRMED`.

Ledger questions: asked in Nov 2026, after examples 1-8 were logged in Oct 2026. The LLM's choice is given in each example.

18. **All spending**: `ask total last month`, LLM picks total, last month. Reply: `Oct 2026, all spending: 38,000.`
19. **One category**: `ask emi last month`, LLM picks category Home loan EMI, last month. Reply: `Oct 2026, Home loan EMI: 32,000.`
20. **By category**: `ask kharcha october ka breakdown`, LLM picks breakdown, october. Reply, one line each:
    `Oct 2026, spending by category:`, `Home loan EMI: 32,000`, `Transport: 4,000`, `Food: 2,000`, `Total: 38,000`.
21. **A stated year**: `ask food october 2025` sends `food october`, and code reads the year. Reply: `Oct 2025, Food: 0.`
22. **Future month refused**: `ask food december`, LLM picks category Food, december. A clarifying question, because December 2026 has not happened.
23. **Refused with no call**: `ask spend on icici`, `ask food last 3 months` and `ask priya 500 icici` each get a clarifying
    question, because the filter would remove a word or a number and so change the question.
24. **No usable answer**: on `unsure`, an answer off the list or a failed call, a fixed reply that says what it can answer or to try again.
    Nothing is written or claimed by any question, and no figure comes from the LLM.

## 6. Message grammar (final, M1)

Deterministic, tokenized, case-insensitive. No LLM in parsing. Implemented in `packages/core`.

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
ask <question>                                     a spending question, answered from a fixed report
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
- Unrecognised category (expenses and splits): no keyword match, keywords from two categories, or an
  income category such as "salary advance", stores the transaction with status `NEEDS_REVIEW`. The category is
  the LLM's guess if it gave one (see Categories below), else null. Income is `Salary` on a salary keyword, else `Other income`.

- `ask` (M5.4): an entry can no longer have a description starting with `ask`. It takes no date prefix. It writes and claims
  nothing. The LLM picks one of three reports (`total`, `category`, `breakdown`) and one month, and code does the rest:
  - One `20xx` word right after a month name is read by code as the year, and is not sent. Any other number is refused.
  - With no month, it means this month. Only this month, last month or a named month can be asked for. A named month
    with no year is in the current IST year, and a future month is refused, never rolled back a year.
  - The category filter is the spending categories. Uncategorised can't be asked for, but it appears in `breakdown`.
  - The question is refused, with no call, if the filter would remove anything from it, if a word resembles an account (`johns` or `kotak` for
    `kotakbank`, or `ic ici` for `icici`), or if it has anything outside plain ASCII, is empty, or is over 100 characters. Dropping a
    word could turn it into a different question with a confident answer. An innocent word can be refused too, which only costs a re-type.
  - The reply shows the month and report, so a misread is visible. With no key configured, questions are switched off.

Reply on every successful write, e.g. `Logged: 4,000 Petrol (Transport) on ICICI-CC. Reply "undo" to revert.`

**Categories** (fixed): Food, Groceries, Transport, Rent, Utilities, Shopping, Entertainment,
Health, Travel, Subscriptions, Home loan EMI, Salary, Other income. A category comes from the keyword rules, the `emi` command
or the income default. On a miss in an expense or split, the fallback (M5.3) asks the LLM, given the filtered description only.
It may only choose from this list, excluding the income categories, or answer `unsure`. It never sees or alters amounts, accounts
or type. A guess keeps status `NEEDS_REVIEW` and the reply says `guessed`. An `unsure` answer, an answer off the list or a failed
call leaves the category null, and the message is still logged. With no key configured, the bot uses keyword rules only. No
LLM runs in the dashboard.

## 7. Architecture (HLD)

```
Telegram bot
        |  webhook (HTTPS)
        v
API Gateway -> Lambda: channel adapter
        |  verify secret token, allowlist sender, build key (chat.id:message_id)
        v
packages/core: ingest(message, store, categorizer?) -> dedupe (claim key) -> parse -> validate -> ledger write
        |                                                        |
        |                                                        +--> category: keyword rules, then on a miss the LLM (Sarvam)
        v
Postgres (Supabase free tier, Mumbai ap-south-1) via Drizzle
        ^
        |  server-side reads
Next.js dashboard (Better Auth + Google OAuth, email allowlist)
```

Key decision: **`core` is pure and channel-agnostic.** Telegram is a
thin adapter, so the channel can be swapped without touching ledger logic.

The LLM call happens between two database transactions, never inside one, so a slow provider cannot hold the
ledger lock. The first transaction finds the miss and writes nothing. The second checks and interprets again, claims and writes.

An `ask` question works the same way, except that its second transaction only reads, in a callback typed to the one read method.

Later: EventBridge -> Lambda for recurring rules (rent, SIP, monthly transfer) and
for Splitwise polling.

## 8. Data model sketch

Illustrative and tool-neutral. The real schema, including the CHECK constraints, is
`packages/db/src/schema.ts`; ids are generated UUID text and timestamps are `timestamptz`.

```prisma
model Account {
  id             String   @id @default(cuid())
  alias          String   @unique   // "icici", "icicicc", "bom", "john"
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
- From M5.2, free-text descriptions go to the chosen LLM provider, and they may hold names and identifiers. Parsed amounts
  and accounts are not sent.
- The M5.2 script (`llm:keywords`) drops account aliases, account names, a card's bank name, an alias without its trailing number (`sbi` for `sbi2`), any token with a digit and any word with an `@`, so
  `dinner with john` goes as `dinner with` if `john` is an account, and `card xx1234 fee` as `card fee`. It shows the owner the
  text and a code, and sends exactly that text only with `--send=<code>`. It cannot catch a person with no account, a
  relation, a place or a spelled-out amount. It writes no file, and on production it needs the `llm:keywords:prod` script and
  refuses to run unless its output is a terminal.
- The M5.3 fallback runs only after the secret and sender checks. It applies the same filter, with the same limits, and sends
  with no preview, one request per keyword miss. Text over 100 characters after the filter is not sent. It sends no parsed
  amount, account or date, and no balance. It has a 3-second timeout, no retries and refuses redirects. Its text and answers
  are never logged: only the labels `llm_guessed`, `llm_unsure` and `llm_failed`. Removing the key from the secret switches it off.
- From M5.4 the text of an `ask` question goes to the LLM provider with no preview, under the same filter, limits and network rules as
  the fallback. It can still hold a name with no account, or a relation. A question goes only after the secret and sender checks, and
  sends no ledger data. The LLM's text never reaches a reply or a log: replies are built by code from the validated choice. The
  labels are `llm_answered`, `llm_unsure` and `llm_failed`.
- Keywords live in a public repo, so only national brands and generic words are added, never a local shop or a person.
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
| M5.1 | Investment accounts: `INVESTMENT` kind, section 5 examples 9-12, "Invested" on the dashboard | Nov 4 |
| M5.2 | Keyword suggestions: a script the owner runs by hand uses an LLM to propose keywords from uncategorised descriptions; the owner reviews them before adding any; no LLM in the bot | Nov 4 |
| M5.3 | Category fallback: on a keyword miss the LLM picks a spending category from the fixed list; a guess stays `NEEDS_REVIEW` and the reply says so; a failed, invalid or `unsure` answer leaves the category null | Nov 5 |
| M5.4 | Ledger questions: `ask`; the LLM picks a fixed read-only report, with a month and category filter, and existing code calculates the answer. No account or type filter, so section 3 is unchanged | Nov 5 |
| M6 | Recurring rules via EventBridge | later |
| M7 | Splitwise read-only sync (flat expenses) | later |

Blog rule: a post is published only after its milestone's tests pass.
HLD post after M3, LLD post after M2, parser post after M1, production post after M4, dashboard post after M5.

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
  latest transaction. Deferred until after M5; see DECISIONS.md (2026-11-01). So keywords from M5.2 only help future
  messages: a stored row keeps the category it has.
- **A wrong guess counts under the wrong category.** In the 2026-11-05 test about 1 in 8 fake descriptions got a wrong
  category, and answers vary between runs. The reply shows the guess. `undo` and a resend may return the same guess, and only
  the latest entry can be undone, so the reliable fix is a keyword, then `undo` and a resend.
- **An `ask` figure can include wrong guesses.** A category figure counts guessed rows, as the dashboard does, with no marker,
  so the two always agree. A misread question shows in the reply's month and report label.
- **The fallback reads Latin letters only.** Devanagari text and any word with a digit, such as `zee5`, are dropped before
  sending, so those need a keyword.
- Backdated entries: DECIDED, supported via `yesterday` / `on 20 oct` prefix. Exact grammar in M1. See DECISIONS.md.
- Omitted account: DECIDED, reply with a clarifying question, write nothing.
- Category list: DECIDED, fixed list in section 6. Add keywords as real use shows gaps.
- LLM provider: DECIDED, Sarvam `sarvam-105b` with reasoning off. See DECISIONS.md (2026-11-05).
- Real descriptions and an LLM provider: DECIDED, allowed for Sarvam. See section 9 and DECISIONS.md (2026-11-04).
- Dashboard auth: DECIDED, Better Auth + Google OAuth with email allowlist.
- Channel: DECIDED, Telegram (secret-token header instead of `X-Hub-Signature-256`). WhatsApp optional later.
