import {
  categorize,
  GUESSABLE_CATEGORIES,
  tokenize,
  type Category,
} from './categories';

import type { AccountInfo } from './types';

/** One distinct description and how many rows hold it. */
export interface DescriptionCount {
  description: string;
  count: number;
}

export type SuggestionRejection =
  | 'bad-json'
  | 'unsure'
  | 'bad-category'
  | 'bad-keyword'
  | 'not-in-text'
  | 'already-known';

export type ParsedSuggestion =
  | { ok: true; keyword: string; category: Category }
  | { ok: false; reason: SuggestionRejection };

export interface Suggestion {
  keyword: string;
  category: Category;
  /** The filtered text it came from, never the original description. */
  text: string;
}

/**
 * A card's alias joins its words (`hdfc cc` is `hdfccc`), so the bank name and `cc`
 * are added. An alias can also end in a number (`sbi2`, `axis2cc`), so it is added
 * without that too.
 */
export const accountWords = (
  accounts: readonly Pick<AccountInfo, 'alias' | 'name' | 'kind'>[],
): string[] =>
  accounts.flatMap(({ alias, name, kind }) => {
    const bank = kind === 'CREDIT_CARD' ? alias.replace(/cc$/, '') : alias;
    const words = [alias, name, bank, bank.replace(/[0-9]+$/, '')];
    return [...new Set(kind === 'CREDIT_CARD' ? [...words, 'cc'] : words)];
  });

/** Split like a description, because `john-k` is a valid alias and tokenizes to two words. */
export const aliasTokens = (aliases: readonly string[]): ReadonlySet<string> =>
  new Set(aliases.flatMap(tokenize));

/**
 * What may leave for the LLM: no account word, no token with a digit, which is
 * where card numbers and flat numbers sit, and no word with an `@`, which is an
 * email or UPI handle. It cannot catch a person with no account, a relation, a
 * place or a spelled-out amount. The script previews the result; the bot does not.
 */
export const sendableText = (
  description: string,
  blocked: ReadonlySet<string>,
): string =>
  tokenize(
    description
      .split(/\s+/)
      .filter((word) => !word.includes('@'))
      .join(' '),
  )
    .filter((token) => !/[0-9]/.test(token) && !blocked.has(token))
    .join(' ');

/**
 * Distinct filtered texts to send. A description an existing keyword matches is
 * skipped: stored rows never change, so it would otherwise go on every run. So is
 * text with only known words, because no new keyword can come from it.
 */
export function prepareBatch(
  rows: readonly DescriptionCount[],
  aliases: readonly string[],
): { texts: string[]; skippedEmpty: number; skippedKnown: number } {
  const blocked = aliasTokens(aliases);
  const texts = new Set<string>();
  let skippedEmpty = 0;
  let skippedKnown = 0;
  for (const { description, count } of rows) {
    const text = sendableText(description, blocked);
    if (categorize(description) !== null) skippedKnown += count;
    else if (text === '') skippedEmpty += count;
    else if (tokenize(text).every((t) => categorize(t) !== null)) {
      skippedKnown += count;
    } else texts.add(text);
  }
  return { texts: [...texts], skippedEmpty, skippedKnown };
}

/** Everything the LLM says is checked here, so a bad answer goes no further. */
export function parseSuggestion(
  content: unknown,
  text: string,
): ParsedSuggestion {
  if (typeof content !== 'string') return { ok: false, reason: 'bad-json' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, reason: 'bad-json' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'bad-json' };
  }

  const { keyword, category } = parsed as Record<string, unknown>;
  if (category === 'unsure') return { ok: false, reason: 'unsure' };
  const allowed = GUESSABLE_CATEGORIES.find((c) => c === category);
  if (!allowed) return { ok: false, reason: 'bad-category' };
  if (typeof keyword !== 'string' || !/^[a-z0-9]+$/.test(keyword)) {
    return { ok: false, reason: 'bad-keyword' };
  }
  if (!tokenize(text).includes(keyword)) {
    return { ok: false, reason: 'not-in-text' };
  }
  // One token returns the category it is already listed under, whichever that is.
  if (categorize(keyword) !== null) {
    return { ok: false, reason: 'already-known' };
  }
  return { ok: true, keyword, category: allowed };
}

/**
 * Forecast only, because stored rows keep the category they have: it says how a
 * future message like each row would go. A row counts if nothing resolves it
 * today and the keyword would leave it with exactly one category. Each keyword
 * is forecast alone.
 */
export function rowsCategorised(
  rows: readonly DescriptionCount[],
  keyword: string,
  category: Category,
): { matched: number; categorised: number } {
  let matched = 0;
  let categorised = 0;
  for (const { description, count } of rows) {
    const tokens = tokenize(description);
    if (!tokens.includes(keyword)) continue;
    matched += count;
    const hits = new Set(tokens.map(categorize).filter((c) => c !== null));
    hits.add(category);
    if (categorize(description) === null && hits.size === 1) {
      categorised += count;
    }
  }
  return { matched, categorised };
}

/** A keyword suggested under two categories is unsafe to offer as either. */
export function summarise(suggestions: readonly Suggestion[]): {
  accepted: Suggestion[];
  twoCategories: number;
} {
  const byKeyword = new Map<string, Suggestion[]>();
  for (const s of suggestions) {
    byKeyword.set(s.keyword, [...(byKeyword.get(s.keyword) ?? []), s]);
  }
  const accepted: Suggestion[] = [];
  let twoCategories = 0;
  for (const group of byKeyword.values()) {
    const [first] = group;
    if (!first) continue;
    if (new Set(group.map((s) => s.category)).size > 1) twoCategories += 1;
    else accepted.push(first);
  }
  return { accepted, twoCategories };
}
