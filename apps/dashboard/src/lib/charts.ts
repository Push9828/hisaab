// Coordinates for server-rendered SVG. Money stays bigint until it is a position
// on screen, which is the only place it becomes a number.

interface Size {
  width: number;
  height: number;
}

const SMALLEST_SCALE = 100_000n; // ₹1,000, so an empty chart still has an axis

/** The largest value, rounded up to 1, 2 or 5 times a power of ten. */
export function niceMax(values: readonly bigint[]): bigint {
  const largest = values.reduce((m, v) => {
    const size = v < 0n ? -v : v;
    return size > m ? size : m;
  }, 0n);
  if (largest <= SMALLEST_SCALE) return SMALLEST_SCALE;
  let power = 1n;
  while (power * 10n < largest) power *= 10n;
  for (const step of [1n, 2n, 5n, 10n]) {
    if (power * step >= largest) return power * step;
  }
  return power * 10n;
}

const points = (values: readonly bigint[], max: bigint, size: Size) =>
  values.map((value, i) => {
    const clamped = value < 0n ? 0n : value > max ? max : value;
    const rise = Number((clamped * BigInt(size.height) * 10n) / max) / 10;
    return {
      x: (size.width * (i * 2 + 1)) / (values.length * 2),
      y: size.height - rise,
    };
  });

/** Control points at the midpoint, so a curve cannot overshoot its two values. */
export function linePath(
  values: readonly bigint[],
  max: bigint,
  size: Size,
): string {
  return points(values, max, size)
    .map((p, i, all) => {
      const before = all[i - 1];
      if (!before) return `M${p.x} ${p.y}`;
      const mid = (before.x + p.x) / 2;
      return `C${mid} ${before.y} ${mid} ${p.y} ${p.x} ${p.y}`;
    })
    .join(' ');
}

export function areaPath(
  values: readonly bigint[],
  max: bigint,
  size: Size,
): string {
  const all = points(values, max, size);
  const first = all[0];
  const last = all[all.length - 1];
  if (!first || !last) return '';
  return `${linePath(values, max, size)} L${last.x} ${size.height} L${first.x} ${size.height} Z`;
}

/** For an arc drawn with pathLength="100". */
export function gaugeDash(perMille: number | null): string {
  const clamped = Math.min(1000, Math.max(0, perMille ?? 0));
  return `${clamped / 10} 100`;
}
