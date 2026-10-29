/** Throws unless the URL names a database ending in `_test`. Used before anything is created or wiped. */
export function assertTestDatabaseUrl(raw: string | undefined): URL {
  if (!raw) {
    throw new Error(
      'TEST_DATABASE_URL is not set. See packages/db/.env.example.',
    );
  }
  const url = new URL(raw);
  if (!/^[a-z0-9]+(_[a-z0-9]+)*_test$/.test(url.pathname.slice(1))) {
    throw new Error(
      'TEST_DATABASE_URL must point at a database ending in _test',
    );
  }
  return url;
}
