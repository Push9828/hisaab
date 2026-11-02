const SMALLEST_VISIBLE = 5n; // per mille

/** A bar's width against the largest value, computed in bigint so money never becomes a float. */
export function barPercent(value: bigint, max: bigint): string {
  if (value <= 0n || max <= 0n) return '0%';
  const perMille = (value * 1000n) / max;
  const shown = perMille < SMALLEST_VISIBLE ? SMALLEST_VISIBLE : perMille;
  return `${Number(shown) / 10}%`;
}
