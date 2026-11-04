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
the secret is not 32-256 chars of `[A-Za-z0-9_-]` (32 minimum after review: it is the only gate on a public URL), or if the allowed user id is missing. Both sides are
SHA-256 hashed before `timingSafeEqual`, which throws on unequal lengths.

**Any error thrown while processing (store failure, or a bug such as a failed invariant check) is logged as `error` and replies 200 `Something went wrong. Check "accounts" before resending.` instead of returning 500.**
Why: a 500 makes Telegram retry a message that may fail every time, for hours, holding up later messages. The
reply does not promise "nothing was saved": the run normally rolls back, but if the connection drops during
COMMIT the write may have landed, and a blind resend (a new message id) would double it. (Changed after review.)

**Ignored silently (200, no reply, no write): wrong sender, non-private chat, `edited_message`, non-text, malformed JSON,
forwarded messages (`forward_origin`, `forward_from`, `forward_from_chat`) and inline-bot messages (`via_bot`).**
Why for forwards: `from.id` is still mine, but the words are someone else's (hard rule 7).
Edits are also excluded by `allowed_updates: ["message"]`. `/start` gets the normal unknown-command clarification.

**Adapter logs are fixed labels only, never an error object.** Why: Drizzle and pg errors carry query
parameters, which include `rawText` (hard rule 8).

**The adapter runs TypeScript with `tsx` 4.23.15 (pinned).** Why: Node's built-in type stripping needs file
extensions in imports, and the workspace uses extensionless imports. `tsx --env-file` also means no dotenv.

## 2026-10-30 (M3 complete)

**M3 is verified end to end from the phone:** Telegram -> cloudflared quick tunnel -> `local.ts` -> `handleWebhook`
-> `ingest` -> Postgres, with the reply returned in the webhook response. The SPEC section 5 examples were run
with fake aliases (checklist in `apps/adapter/README.md`). The temporary step plan is deleted; its decisions are above.

**An empty `accounts`/`bal` reply now says "No accounts yet. Add one: open <alias> <amount> <kind>".**
Why: found in the M3 smoke test. Telegram rejects a `sendMessage` with empty text, so the user saw nothing.

**Test rows are wiped before real use, by dropping the local dev database.** Why: accounts cannot be voided,
so fake test accounts would otherwise stay in the account list.

**The tunnel is cloudflared with `--protocol http2`.** Why: no signup. Its "critical failures" pre-check can be
caused by a VPN kill switch (ProtonVPN here) rather than the network. Its TLS ends at Cloudflare, so real
messages and balance replies are readable by Cloudflare. M4 removes this extra hop; TLS will then end at AWS API Gateway.

**Telegram delivers one update at a time (`max_connections: 1` in `setWebhook`).**
Why: with the default of 40 parallel deliveries, the run lock serialises messages but not in order, so a quick
`undo` could void the entry before the one it was meant for, and `bal` could reconcile against a stale balance.
One connection is plenty for a single user.

**The local server checks the secret before reading the body, and has short timeouts** (5s headers, 10s request,
checked every second, 50 connections). Why: the tunnel URL is public; strangers must not hold connections open.
A pool `error` listener, a startup `select 1`, and uncaught-error handlers print labels only, never a stack trace.

## 2026-10-30 (M4 plan)

**The bot token never reaches the Lambda.** SPEC M4 row and section 9 reworded ("permanent token" was a
WhatsApp leftover: BotFather tokens do not expire). Why: the reply goes back in the webhook response body (M3),
so only `set-webhook` on the laptop needs the token. A Lambda that cannot hold it cannot leak it.

**Production Postgres is Supabase in Mumbai (ap-south-1), the same region as the Lambda.**
Why: one region means no cross-region round trip on every query, and the data stays in India. Neon's nearest
region is Singapore. The Lambda uses Supabase's direct (non-pooled) endpoint with `sslmode=verify-full`.
Why direct: transaction-mode poolers can reject `statement_timeout` as a startup parameter, and one Lambda at a
time needs no pooler.

**The Lambda reads one JSON secret from Secrets Manager: `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ALLOWED_USER_ID`,
`DATABASE_URL`.** It passes through the same `parseConfig` as the local server. The production webhook secret is
new, not the dev one. Why the user id is in the secret: it is not secret, but this keeps the real id out of the
repo, the template and `samconfig.toml` (hard rule 9).

**Production starts empty.** Nothing is copied from the local database, which held only test rows.

**The stack deploys to a personal AWS account through a named SSO profile (`hisaab`).**
Why: short-lived credentials, no long-lived access keys on disk, and financial data stays out of shared accounts.

**The stack is deployed with AWS SAM, not Terraform or CDK.**
Why: the stack is one Lambda, one HTTP API route, one log group and one IAM grant, in one account and region.
- SAM is CloudFormation underneath, so AWS keeps the deployed state. There is no state file to lose, lock or
  protect; a safe Terraform setup would need an S3 bucket and a DynamoDB lock table, more infrastructure than the app.
- One `AWS::Serverless::Function` with an `HttpApi` event expands into the function, role, API, route, stage,
  integration and invoke permission. Terraform needs these as 8-10 hand-wired resources.
- A failed deploy rolls back to the last good stack. `sam local invoke` runs the handler in the real Lambda runtime.
- SAM was already installed and has its own AWS client.
Rejected: Terraform. Its strengths are multi-provider stacks, a clearer `plan`, and big multi-environment estates,
and none of these apply: Supabase and the Telegram webhook are set once by hand or by script. CDK: a CLI, a
bootstrap stack and npm dependencies for a handful of resources. Console clicks: not repeatable, reviewable or in git.
Revisit if there are several environments, or Supabase and DNS should be managed as code. The Lambda code does not
depend on the deploy tool, so switching is cheap.

## 2026-10-31 (M4 step 6)

**The Lambda and prod migrations use Supabase's Session pooler (port 5432), not the direct endpoint.** This
replaces "direct (non-pooled) endpoint" and "`sslmode=verify-full`" in the 2026-10-30 entry (TLS is now set in
code, see below). Why: the direct host `db.<ref>.supabase.co` is
IPv6-only, and a Lambda outside a VPC has no IPv6 egress. The Session pooler is IPv4 and gives each client its own
server connection for the session, so the transaction-scoped advisory lock behaves as before.
Rejected: the IPv4 add-on (paid, for one user), a dual-stack VPC (out of scope), the Transaction pooler (6543).

**`statement_timeout` is 10s, set with `SET LOCAL` at the start of every run, not as a startup parameter.**
Why: poolers may reject startup parameters they do not know; `SET LOCAL` works on any endpoint and resets at
commit. 10s sits below the Lambda's 20s timeout. All queries go through `run()`, so none escape the limit.

**TLS to Supabase is configured in code, verified against Supabase's root CA, which is embedded in `@hisaab/db`.**
Why: pg lets any `ssl*` parameter in the URL replace the `ssl` option wholesale, and a URL without one connects in
plaintext. So `parseDatabaseUrl` (used by `createDb`, the Lambda's settings load and `migrate.ts`) rejects `ssl*`, `host`
and `port` query parameters, after decoding their names (`%73slmode` is `sslmode`), and the Lambda and
`db:migrate:prod` always pass the CA. Node verifies the chain and the host name (libpq's `verify-full`).
The CA is public; in code, the Lambda bundle needs no file path. It expires 2031-04-26.

**Migrations, local and prod, run through one script, `packages/db/scripts/migrate.ts`, not `drizzle-kit migrate`.**
`db:migrate` runs it with `tsx --env-file=.env`, `db:migrate:prod` with `--env-file=.env.production`. A `localhost`
host connects without TLS; any other host requires TLS with the Supabase CA, so prod can only fail closed.
drizzle-kit keeps `db:generate`. Same migrator (drizzle-orm's), migrations folder and journal.
Why not drizzle-kit:
- It loads `packages/db/.env` (dotenv) before reading the config, and `process.loadEnvFile` never overwrites a
  variable already set. A config loading `.env.production` therefore still got the local `DATABASE_URL`, pointed the
  prod TLS settings at local Docker ("server does not support SSL connections"), and drizzle-kit swallowed the error
  (`renderWithTask` exits 1 without printing). Without the CA requirement it would have migrated the local DB and
  reported success.
- Making it work (`util.parseEnv`, URL split into fields because its `url` form takes no `ssl`) duplicates the TLS
  setup from `createDb` and still prints nothing on failure.
The script reuses `createDb`, the Lambda's connection path, and prints failures with the URL and password redacted.

## 2026-10-31 (M4 complete)

**The webhook runs on Lambda behind API Gateway; the tunnel is out of the production path.** Deployed and
verified: a request without the secret header gets 401, `getWebhookInfo` shows no errors, and CloudWatch holds only
runtime lines and labels. A message takes about 0.3-0.6s, including a fresh TLS connection to Supabase.

**There is one bot for development and production.** Why: a second bot means a second token, user-id lookup and
chat for no gain to one user. The cost: `webhook:set` (tunnel) takes the bot off production until
`webhook:set:prod`. Local and production data stay separate (Docker vs Supabase). Revisit if local testing while
production is live becomes frequent.

**A changed secret takes effect at the next cold start, forced with a configuration change.** Why: the Lambda
caches the secret for its lifetime (one Secrets Manager call per cold start). Rotations are rare and manual, so
forcing a cold start (README) beats a cache TTL, which would add a call and a failure mode to warm invocations.

**`webhook:info` replaces the `tg getWebhookInfo | grep` one-liner.** It prints the host and status fields only,
never the token, and is the check after every deploy or webhook change.

## 2026-10-31 (M4 review)

**Accepted: anyone with the webhook URL can use up the API Gateway throttle (2 rps, burst 5) and delay messages.**
Why: Telegram retries 429s, so nothing is lost, and the throttle is what caps the cost. Reserved concurrency was
skipped in step 5 (account quota). Mitigation: the URL stays out of the repo, blog posts and screenshots.

**Kept: a body over 64 KB with a valid secret gets 413, not 200.** Why: only Telegram holds the secret, and real
updates are far below 64 KB (text is capped at 4096 characters), so the queue-stall risk the review raised is
theoretical. Changing it means changing the M3 local server too. Revisit if `webhook:info` ever shows a stuck 413.

**`webhook:info` reads `.env`, not `.env.production`.** Why: there is one bot and one token; the README's
token rotation updates both files.

**Supabase's Data API is off (confirmed in the dashboard, 2026-10-31).** Why: Drizzle creates the tables in `public`, which Supabase publishes over
PostgREST to the `anon` role by default. Hisaab only connects over Postgres, so the API is pure exposure.

## 2026-11-01

**Deferred: correcting older transactions. Not in M5; the M5 dashboard stays read-only.** Why: there are two real gaps,
but how often they matter is unknown until the dashboard has been used for a few weeks. `NEEDS_REVIEW` rows have no
way to get a category, and `undo` only voids the latest transaction, so an older mistake means undoing everything
after it (`bal` corrects the balance but leaves the wrong row in reports).
If real use justifies it, add only two actions: set a category, and void a specific transaction (re-enter through
the bot if needed). No direct edits to amount, account or type: those carry the ledger rules, and void plus re-enter
keeps a record of what changed. Try the bot first (e.g. `void 142`): it stays the only write path and adds no attack
surface. Move to the dashboard only if picking rows by number proves annoying. Dashboard writes would need write
access beyond the read-only role, server actions with CSRF protection, and must go through `core`, not direct SQL.

**The "public version" is the source code, not a hosted instance.** Anyone can run their own single-user copy with
their own tokens and accounts. Portfolio screenshots come from a local database seeded with fake data. Why: resolves
the conflict between SPEC section 1 (public version) and section 3 (no public hosting). A hosted demo would need a
second deployment, and a no-login demo mode is one wrong env var away from exposing real data. Consequence: emails,
sender ids and hostnames stay in env vars. Making the repo public is a separate step outside M5, and needs a scan of
the git history for secrets and personal data first.

**Cash flow: in = INCOME, out = `spendAmount`, net = in - out, per IST month; shown for the selected month plus a
6-month table.** Definition in SPEC section 4. Why: out then always equals the spend report. A card spend lowers the
card when you swipe; paying the bill lowers the bank account named in the message and clears the card, and adds
nothing to out, because counting both would double count. ADJUSTMENT is a separate line outside net: it corrects
drift and is neither income nor spending. Rejected: bank-only cash movement, which counts the bill when paid, counts
lending as out, ignores card spend and so disagrees with the spend report.

**The People panel shows both "owes me" and "I owe".** Overpaid receivables go under "I owe"; zero balances are hidden.
Why: showing only receivables would make what you owe invisible.

**Uncategorised spend is shown as an "Uncategorised" bucket.** Why: `NEEDS_REVIEW` rows have real `spendAmount`, and
leaving them out would make category totals disagree with total spend.

**The dashboard is hosted on Vercel, function region `bom1` (Mumbai), with preview deployments off and env vars
scoped to Production only.** Why: easiest setup, and the region is next to Supabase Mumbai (Hobby allows one function
region; new projects default to `iad1`, so it must be set). A preview URL holding production env vars would be a
second door to real data. Connects through the Session pooler, as the Lambda does, because there is no IPv6 egress.

**Better Auth sessions are stored in the database, in a `better_auth` Postgres schema.** Why: server-side sessions
make "sign out everywhere" work after a lost laptop; cookie-only sessions cannot be revoked. Not the `auth` schema,
which Supabase owns. A separate schema also keeps Better Auth's `account` table visibly apart from our `Account`.

**The dashboard uses a least-privilege role, `hisaab_dashboard`.** `SELECT` on `Account` and `Entry`; on `Transaction`
only the columns the reports use, so no `rawText`, `description`, `channel` or `externalId`; nothing on
`ProcessedMessage`; read/write rows only on `better_auth`. Own password, dashboard env only, created by a hand-run
script (`packages/db/scripts/dashboard-role.sql`), not a committed migration. Why: a dashboard bug or leaked credential
then cannot change the ledger or read message text. A future transaction list would need `description` granted, as an
explicit change. The script sets no password: `\password` in psql hashes it on the client, whereas a psql variable
would send plain text in an `ALTER ROLE` that can reach server logs and query statistics. Supabase's Session pooler accepts
the custom role as `hisaab_dashboard.<project-ref>`, checked on production with `pnpm db:check:role:prod` (2026-11-02).

**The dashboard keeps one module-level pool: `max: 1`, about 5s idle timeout, through `createDb`.** Reads run in a
read-only transaction with `SET LOCAL statement_timeout` and no advisory lock. Why: server components have no natural
per-request place to close a pool, and one connection is enough for one user. The advisory lock only serialises
ledger writes, so reads do not need it.

## 2026-11-02

**The dashboard's CSP is `script-src 'none'`: the browser runs no JavaScript at all.** Why: the pages are server-rendered
HTML with no client components, so nothing needs a script, and injected markup then cannot execute. Checked in Chrome
against a production build, with a no-CSP control: an inline script ran without the header and was blocked with it.
Next still sends its script tags, so the console logs a CSP violation for each one; that noise is expected. Consequences:
sign-in, the month picker and error pages must work without JavaScript; `error.tsx` is a client component and will not
run; style attributes are blocked too, so report bars cannot use inline widths. Rejected: nonces, which need a proxy on
every request and would allow the framework's scripts we do not use; `'unsafe-inline'`, which removes the protection.
If a page ever needs client code, this is the decision to revisit.

**Sign-in and sign-out are server actions, and the only Better Auth URL exposed is `GET /api/auth/callback/google`.**
Why: Better Auth's own sign-in endpoint takes JSON, which a form without JavaScript cannot send, and exposing only the
callback leaves its other endpoints unreachable. Two headers follow from this, both confirmed in Chrome by removing each
one: `Referrer-Policy` is `same-origin`, because `no-referrer` makes form posts carry `Origin: null` and fail the server
action origin check; `form-action` allows `https://accounts.google.com`, because Chrome applies it to the redirect.
Rejected: a catch-all `[...all]` route, which would expose every endpoint for no use here.

**Sign-out ends every session, and a session lasts a fixed 7 days with no refresh.** Why: with one user, a lost laptop
is the main reason to sign out. Refreshing would write during page reads, and a page render cannot set the new cookie
anyway. Google's OAuth tokens are never used, but Better Auth stores them, so the access token is encrypted with
`encryptOAuthTokens`. That option does not cover the id token, which holds the owner's email and name, so a hook stops it
being stored at all. Sign-in state lives in an encrypted cookie, so an anonymous click on sign-in writes no database row.

**Dashboard errors are caught where they happen and logged as fixed text; Better Auth's logger prints only the level.**
Why: with the database down, a failed query's message holds its parameters, and Better Auth's default logger printed the
session token (hard rule 8). Next prints uncaught errors the same way, so the page load, sign-in, sign-out and the
callback each catch theirs. Cost: logs say what failed but not why, so a real failure is diagnosed by reproducing it.
Rejected: `error.tsx`, the plan's choice, which is a client component and cannot run under the no-script CSP.

**Report bars are SVG rectangles with a percentage `width` attribute.** Why: the CSP blocks inline styles, and an SVG
attribute is not a style. Rejected: `<meter>`, which is styled differently in each browser. Every bar has its amount
beside it as text, so there is no hover tooltip to miss.

**Fake data goes in its own local database, `hisaab_demo`, never the dev database.** Why: the dev database can hold what
the bot wrote locally, and fake rows mixed into it could not be told apart or removed, since nothing is hard-deleted. The
seed goes through `ingest`, with fixed ids so a second run is a no-op, and refuses a non-local `DATABASE_URL`. Dates are
fixed rather than relative to today, so screenshots repeat; open `/?month=2026-10` to see them.

**The dashboard has a designed look, with four pages: Overview, Spending, Accounts and People.** This replaces the M5
plan's "readable tables, no polish": plain tables were not something the owner wanted to open. Dark navy and blue glass,
dark only, in the style of the references the owner chose, recreated with no code or images taken from them. Tailwind
runs at build time and leaves a static CSS file; icons and charts are SVG rendered on the server, so the no-script CSP
stays. Rejected: JavaScript chart libraries and component kits, which would need browser code and send financial data to
it (SPEC section 9), and shadcn/ui, whose default look we would have restyled entirely. Cost: no animated charts, and
only the browser's plain tooltips. Chart colours passed the palette check for colour-blind readers, and Out is also
dashed. The font is downloaded at build time and served by the app, so the browser never calls Google.

**The transaction list waits until after M5.** It needs `description`, which the dashboard role cannot read, so it is
its own decision. It is a good next feature, since it also helps find mistakes in older entries.

**The repo stays private until M5 is reviewed.** It was public briefly on 2026-11-02; a scan of the history found no
secrets, project addresses or real ids, but every commit carries the owner's email. Going public later needs that history
rewritten to GitHub's noreply address, and a fresh scan.

**`dashboard-role.sql` checks the role's attributes instead of setting them.** Why: on Postgres 17 only a role that holds an
attribute may change it, so `ALTER ROLE ... NOSUPERUSER` fails for an admin who is not a superuser, which is what Supabase's
`postgres` is expected to be. `CREATE ROLE` leaves them all off, and the script now stops if any has been switched on.

**Row-level security is on for all ledger tables, in a migration, and `hisaab_dashboard` reads through a `SELECT`-only policy.**
Production already had it on with no policies, which is what keeps Supabase's `anon` and `authenticated` roles out even
though they hold table grants. Nothing in the repo recorded that, so migration 0002 now does, and local tests run the same
way (it is a no-op on production). The side effect: a non-owner role reads zero rows with no error, so the dashboard would
have shown 0 everywhere. Rejected: `BYPASSRLS` for the role, which would remove the protection for it entirely. The bot's
role owns the tables, so it is exempt and unaffected.

**M5 review, 2026-11-02: what was left as it is.** Found by the code and security reviews and accepted for now: Supabase's
`anon` and `authenticated` roles keep their table grants, because the Data API is off and row-level security is on, so
removing them is hardening for later. Better Auth prints directly if the user lookup during a session check fails: no
setting turns that off, and it should hold no token or email. A failed page returns HTTP 200 with a fixed message.
Totals on the Accounts page net an overpaid card against the others.

## 2026-11-02 (M5 complete)

**M5 is done: the dashboard runs in production.** Verified on the deployed site: the allowlisted account signs in and a
second account is rejected, a bot message appears on the dashboard, signed-out pages redirect with no data, the headers
are present, the region is `bom1`, and `pnpm db:check:role:prod` passes through the Session pooler. Reviewed by
`code-reviewer` and `security-reviewer`; what was fixed and what was left is above.

**Left out of M5 on purpose:** a `ReportStore` interface in core (one implementation), a chart library, tRPC, data API
routes, client state, a caching layer, a demo mode, middleware as a security boundary, and a widget system. If one of these
comes up, it needs its own reason.

**Still out of scope, as decisions for later:** the transaction list, and correcting older transactions (both above);
budgets and forecasting (SPEC section 3); net worth, because loan balances go stale under the EMI limitation; search and CSV
export; a custom domain; a hosted public demo; Splitwise; recurring rules (M6). Before making the repo public: revoke
`anon` and `authenticated` grants, rewrite the email out of the commit history, and scan again.

## 2026-11-04 (M5.1 plan)

**Investments are a new account kind, `INVESTMENT`, not a spending category.** Why: buying a fund moves money between
my own accounts, so it is a TRANSFER with `spendAmount = 0`. As a category it would count in out and lower net and the
savings rate, and money invested would look like money spent. Hard rule 3 then covers it with no new ledger rule.

**One account per mutual fund, plus one `stocks` account for all shares.** Why: a separate account per stock would add
messages without adding anything a cost-only balance can show.
Real fund names stay out of the repo (hard rule 9); aliases are set by the owner with `open` in production.

**`xfer` only, no `invest` command for now.** Why: `xfer` already does the job, and a second word for the same
transaction adds grammar with no new behaviour. Revisit if real use shows `xfer` is awkward.

**An investment balance is money put in minus money taken out, never market value.** Why: market value needs a price
feed or manual updates, which is a different product (SPEC section 3). A sale for more than went in turns the balance negative, with
no warning, as an overpaid `got` does.

**`bal <investment> <amount>` is refused at any amount, including 0.** Why: the number anyone would state comes from a
statement, which is market value. Accepting it would write an ADJUSTMENT that turns a cost figure into a mix of cost and
value, silently. Rejected: refusing only when the amount differs, which makes the reply depend on the balance.

**Invested is net, over non-voided TRANSFER entries on INVESTMENT accounts, and sits outside in, out, net and savings
rate.** Why: fund-to-fund moves must net to 0, and a sale should reduce it. The dashboard card is labelled "Invested", not
"Invested this month", matching "Money in", "Money out" and "Net", which also follow the selected month with no month in
their labels.

**Investment accounts get their own row, M5.1, separate from M6.** Why: recurring rules are unrelated work. No blog post
is planned for it.

**Do not roll the adapter back past M5.1 once an investment account exists.** Why: older code negates an unknown kind in
`signedBalance` and has no `bal` refusal, so `bal <fund> <amount>` on an old Lambda would write an inverted ADJUSTMENT. The
enum value also cannot be dropped with a simple statement. Deploy order: `db:migrate:prod`, then `deploy:aws`, then
`git push`, and only then the `open` messages. No `db:role:prod` is needed: the migration changes no grants.


## 2026-11-04 (M5.1 built)

**M5.1 is built and reviewed by `code-reviewer` and `security-reviewer`; it is not deployed yet.** All tests pass locally,
including against Postgres. The pages were checked in Chrome as rendered HTML with the built CSS and fake data, not through a
signed-in session. Nothing has been run against production.

**A wrong opening balance on an investment account is documented, not fixed.** Found in review: `open` is not undoable and
`bal` is refused, so the only repair is an `xfer` plus a `bal` on the bank, which leaves a false figure in that month's
Invested (SPEC section 12). Why not fixed: a correction command is a grammar change, and it may never be needed.

**Stat cards have a 13rem minimum, down from 14rem, and Invested has no plus sign.** Why: five cards then fit on one row at
1440px. In Chrome, `+₹12,34,567` broke after the plus at that width, and a plus says nothing on a figure that is plainly money
put in. Net keeps its plus, so a Net of `+₹10,00,000` or more can still wrap near that width. Below about 1400px the fifth card
moves to a second row.
