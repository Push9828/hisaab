-- The dashboard's database role: least privilege (see docs/DECISIONS.md).
--
-- Hand-run by whoever owns the tables, after migrations. Safe to run again: it
-- takes back anything granted since, and re-run it when better_auth gains a table.
-- Never a committed migration, so that migrations cannot widen this by accident.
--
-- It sets no password, and a role without one cannot log in. Set it afterwards in
-- psql with \password hisaab_dashboard, which hashes it on the client, so the
-- plain text never reaches server logs or query statistics.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hisaab_dashboard') THEN
    CREATE ROLE hisaab_dashboard LOGIN;
  END IF;
END
$$;

ALTER ROLE hisaab_dashboard
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- Start from nothing. Revoking at table level also removes column grants.
REVOKE ALL ON "Account", "Entry", "Transaction", "ProcessedMessage"
  FROM hisaab_dashboard;
REVOKE ALL ON ALL TABLES IN SCHEMA better_auth FROM hisaab_dashboard;
REVOKE ALL ON SCHEMA public, better_auth FROM hisaab_dashboard;

-- The ledger: read only, and only what the reports use. No "rawText", "description",
-- "channel" or "externalId", and nothing at all on "ProcessedMessage".
GRANT USAGE ON SCHEMA public TO hisaab_dashboard;
GRANT SELECT ON "Account", "Entry" TO hisaab_dashboard;
GRANT SELECT (
  "id", "type", "occurredAt", "category", "spendAmount", "voidedAt", "seq"
) ON "Transaction" TO hisaab_dashboard;

-- Sign-in: read and write rows, but not change the tables.
GRANT USAGE ON SCHEMA better_auth TO hisaab_dashboard;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA better_auth
  TO hisaab_dashboard;

COMMIT;
