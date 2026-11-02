import { formatInr } from '@hisaab/core';

const MINUS = '−';

export const inr = (paise: bigint): string =>
  paise < 0n ? `${MINUS}₹${formatInr(-paise)}` : `₹${formatInr(paise)}`;

export const signedInr = (paise: bigint): string =>
  paise > 0n ? `+${inr(paise)}` : inr(paise);

/** From tenths of a percent. */
export const percent = (perMille: number): string =>
  perMille < 0 ? `${MINUS}${-perMille / 10}%` : `${perMille / 10}%`;

export function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  const letters =
    words.length > 1 ? `${words[0]?.[0]}${words[1]?.[0]}` : name.slice(0, 2);
  return letters.toUpperCase();
}
