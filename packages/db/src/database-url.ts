/**
 * Parses DATABASE_URL. The URL holds the password, so every error here is
 * fixed text: Node's own invalid-URL error carries the whole input.
 *
 * Query parameters pg would act on are rejected, because pg reads them after
 * decoding (`%73slmode` is `sslmode`) and lets them override the URL and our
 * options: ssl* replaces the `ssl` option wholesale (TLS off or unverified),
 * and host/port replace the host and port that callers inspect.
 */
export function parseDatabaseUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      'DATABASE_URL is not a valid URL (percent-encode special characters in the password)',
    );
  }
  for (const key of parsed.searchParams.keys()) {
    const k = key.toLowerCase();
    if (k.startsWith('ssl') || k === 'host' || k === 'port') {
      throw new Error(`DATABASE_URL must not set the ${k} parameter`);
    }
  }
  return parsed;
}
