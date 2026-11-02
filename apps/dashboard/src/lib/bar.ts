const SMALLEST_VISIBLE = 5n; // per mille

/** Computed in bigint, so money never becomes a float. */
function perMille(value: bigint, max: bigint): number {
  if (value <= 0n || max <= 0n) return 0;
  const scaled = (value * 1000n) / max;
  return Number(scaled < SMALLEST_VISIBLE ? SMALLEST_VISIBLE : scaled);
}

/** A bar's length against the largest value. */
export const barPercent = (value: bigint, max: bigint): string =>
  `${perMille(value, max) / 10}%`;

/** Where a bar growing up from the baseline starts. */
export const barTop = (value: bigint, max: bigint): string =>
  `${(1000 - perMille(value, max)) / 10}%`;
