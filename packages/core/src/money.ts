export type Paise = bigint;

/** Sanity cap: 10 crore rupees. Catches typos like an extra zero or two. */
export const MAX_PAISE: Paise = 10_000_000_000n;

const PATTERN = /^(\d+)(?:\.(\d+))?([kl])?$/i;
const SUFFIX: Record<string, bigint> = { k: 1_000n, l: 100_000n };

export type AmountResult = { ok: true; paise: Paise } | { ok: false };

/**
 * Parses "450", "4k", "1.5k", "1.2l" into integer paise using exact bigint
 * arithmetic. Anything that is not a whole number of paise is rejected.
 */
export function parseAmount(
  token: string,
  { allowZero = false }: { allowZero?: boolean } = {},
): AmountResult {
  const match = token.length <= 20 ? PATTERN.exec(token) : null;
  if (!match) return { ok: false };

  const frac = match[2] ?? '';
  const multiplier = SUFFIX[(match[3] ?? '').toLowerCase()] ?? 1n;
  const scaled = BigInt((match[1] ?? '') + frac) * multiplier * 100n;
  const scale = 10n ** BigInt(frac.length);
  if (scaled % scale !== 0n) return { ok: false };

  const paise = scaled / scale;
  if (paise === 0n && !allowZero) return { ok: false };
  if (paise > MAX_PAISE) return { ok: false };
  return { ok: true, paise };
}

/** Indian digit grouping (1,25,000). Paise shown only when non-zero. */
export function formatInr(paise: Paise): string {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const rupees = (abs / 100n).toString();
  const remainder = abs % 100n;

  const groups: string[] = [];
  let rest = rupees.slice(0, -3);
  while (rest.length > 2) {
    groups.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) groups.unshift(rest);
  groups.push(rupees.slice(-3));

  const fraction =
    remainder === 0n ? '' : `.${remainder.toString().padStart(2, '0')}`;
  return `${negative ? '-' : ''}${groups.join(',')}${fraction}`;
}
