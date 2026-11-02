# Dashboard

A server-rendered Next.js app showing balances, spending, cash flow and who owes whom. It is read-only: the bot is the only way to write to the ledger. Decisions and the reasoning behind them are in `docs/DECISIONS.md`; the rules are in `docs/SPEC.md` sections 4 and 9.

The browser runs no JavaScript at all (`script-src 'none'`), so anything added here must work as plain HTML, forms and links. Next still sends its script tags, so the console logs a CSP violation for each one. That is expected.

## Run it locally

Needs Docker.

```
cp packages/db/.env.example packages/db/.env         # choose a local password
cp apps/dashboard/.env.example apps/dashboard/.env   # fill it in; see the comments
pnpm --filter @hisaab/db db:up
pnpm db:migrate
pnpm --filter @hisaab/db db:role                     # creates hisaab_dashboard and its grants
docker exec -it hisaab-db-1 psql -U hisaab -d hisaab -c '\password hisaab_dashboard'
pnpm --filter @hisaab/dashboard dev
```

The role has no password until you set one, and without it the dashboard only says it could not load. Use the same password in `DATABASE_URL` in `apps/dashboard/.env`.

`next dev` also writes an `AGENTS.md` here. It is gitignored.

### Fake data

```
pnpm --filter @hisaab/db db:seed
```

Fills a separate local database, `hisaab_demo`, with three months of fake data. It never touches another database and refuses a non-local URL. To use it, end `DATABASE_URL` in `apps/dashboard/.env` with `/hisaab_demo`, then open `/?month=2026-10`. The dates are fixed so screenshots repeat.

Running the tests sets the role's password to your local admin password, because roles are shared across the whole Postgres server. Using that same password in `apps/dashboard/.env` keeps both working.

## Environment variables

Set on Vercel for **Production only**, so a preview deployment could not reach real data. A change takes effect only on a new deployment.

| Name | Value |
|---|---|
| `DATABASE_URL` | Session pooler, as `hisaab_dashboard.<project-ref>`, never the admin role. No `?sslmode`: TLS is verified in code |
| `ALLOWED_EMAILS` | Comma-separated. Everyone else is rejected. If it is unset or empty, nobody can sign in and the pages say they could not load |
| `BETTER_AUTH_URL` | The site's address, with no trailing slash |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32`. Different from the local one |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | The production OAuth client, which is separate from the local one |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1`, so Vercel uses the pnpm version the repo pins |

## Deploy

Pushing to `main` deploys. The Vercel project has Root Directory `apps/dashboard`, the region `bom1` from `vercel.json`, and preview deployments off.

### When the database changes

Run these from the repo root, against production:

```
pnpm --filter @hisaab/db db:migrate:prod
pnpm --filter @hisaab/db db:role:prod          # again whenever better_auth gains a table
pnpm --filter @hisaab/db db:check:prod         # read-only: counts, grants and policies
pnpm --filter @hisaab/db db:check:role:prod    # connects as the role and tries what it should and should not do
```

`db:check:role:prod` reads `apps/dashboard/.env.role-check` (gitignored), which holds the same `DATABASE_URL` as Vercel. Don't name it `.env.production`: `next build` would load it, and a local build would then use the production database.

Locally, `db:check` is the read-only report.

Row-level security is on for every ledger table. A new table the dashboard reads needs a column grant and a policy in `packages/db/scripts/dashboard-role.sql`, and a new column on `Account`, `Entry` or `Transaction` needs its grant added. Without the policy the role reads zero rows with no error, so the dashboard shows 0. Without the grant, the page fails to load.

### Setting up a new deployment

1. Run `db:migrate:prod`, `db:role:prod` and `db:check:prod`.
2. Set the role's password. In psql, connected as the admin:
   ```
   \password hisaab_dashboard
   ```
   This hashes it on your machine. Use `openssl rand -hex 32`, which is safe in a URL.
3. Put the role's URL in `apps/dashboard/.env.role-check`, and run `db:check:role:prod`.
4. Create a Google OAuth client of type Web application, with the redirect URI `https://<your-site>/api/auth/callback/google`. Leave the consent screen in Testing, with your accounts as test users.
5. Create the Vercel project and set the variables above.

## Rotating secrets

Rotate at once if one may have leaked. Each needs a redeploy on Vercel.

- **Role password:** `\password hisaab_dashboard` in psql, then update `DATABASE_URL` on Vercel and in `apps/dashboard/.env.role-check`, and redeploy. The dashboard shows its failure message until the redeploy finishes. The bot is unaffected.
- **`BETTER_AUTH_SECRET`:** set a new one and redeploy. This ends every session, so you sign in again.
- **Google client secret:** add a new secret to the client in Google Cloud, update `GOOGLE_CLIENT_SECRET`, redeploy, then delete the old secret.

**After a lost laptop:** sign in from another device and use **Sign out everywhere**, which ends every session. Then rotate anything that was stored on it.

## Logs

Errors are logged as fixed text on purpose: a failed query's message holds its parameters, which can include a session token. So a log says what failed but not why, and a real failure is diagnosed by reproducing it locally. Never log an error object here.

One exception remains. Better Auth prints directly if the query fetching the user during a session check fails, and no setting turns that off. It should hold the query and the internal user id, but no token or email.
