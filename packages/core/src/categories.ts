export const CATEGORIES = [
  'Food',
  'Groceries',
  'Transport',
  'Rent',
  'Utilities',
  'Shopping',
  'Entertainment',
  'Health',
  'Personal care',
  'Religious & spiritual',
  'Travel',
  'Subscriptions',
  'Home loan EMI',
  'Salary',
  'Other income',
] as const;

export type Category = (typeof CATEGORIES)[number];

const INCOME_CATEGORIES: readonly Category[] = ['Salary', 'Other income'];

export const SPENDING_CATEGORIES: readonly Category[] = CATEGORIES.filter(
  (c) => !INCOME_CATEGORIES.includes(c),
);

/** Spending never carries an income category; it goes to review instead. */
export const spendCategory = (c: Category | null): Category | null =>
  c !== null && INCOME_CATEGORIES.includes(c) ? null : c;

export const KEYWORDS: Readonly<Partial<Record<Category, readonly string[]>>> =
  {
    Food: [
      'swiggy',
      'zomato',
      'dinner',
      'lunch',
      'breakfast',
      'coffee',
      'restaurant',
    ],
    Groceries: [
      'groceries',
      'grocery',
      'blinkit',
      'zepto',
      'bigbasket',
      'vegetables',
    ],
    Transport: [
      'petrol',
      'diesel',
      'fuel',
      'uber',
      'ola',
      'metro',
      'auto',
      'cab',
      'parking',
      'fastag',
      'toll',
      'rapido',
    ],
    Rent: ['rent'],
    Utilities: [
      'electricity',
      'water',
      'gas',
      'internet',
      'wifi',
      'broadband',
      'recharge',
      'dth',
      'lpg',
    ],
    Shopping: ['amazon', 'flipkart', 'myntra', 'clothes', 'shoes'],
    Entertainment: ['movie', 'movies', 'pvr', 'concert', 'games'],
    Health: ['doctor', 'medicine', 'pharmacy', 'hospital', 'gym'],
    'Personal care': [
      'haircut',
      'salon',
      'barber',
      'grooming',
      'spa',
      'parlour',
      'parlor',
    ],
    'Religious & spiritual': [
      'temple',
      'mandir',
      'samagri',
      'havan',
      'aarti',
      'prasad',
      'donation',
      'astrologer',
      'astrology',
      'aol',
      'artofliving',
    ],
    Travel: ['flight', 'hotel', 'train', 'irctc', 'trip'],
    Subscriptions: [
      'netflix',
      'spotify',
      'prime',
      'youtube',
      'icloud',
      'hotstar',
      'zee5',
    ],
    Salary: ['salary', 'payroll'],
  };

/** Lowercase words of a-z and 0-9. Devanagari and other non-Latin text is a separator. */
export const tokenize = (description: string): string[] =>
  description
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * Deterministic keyword match on whole lowercase tokens. Returns null when
 * nothing matches or keywords from different categories conflict; the caller
 * marks that NEEDS_REVIEW.
 */
export function categorize(description: string): Category | null {
  const tokens = tokenize(description);
  const hits = new Set<Category>();
  for (const [category, words] of Object.entries(KEYWORDS)) {
    if (words.some((w) => tokens.includes(w))) hits.add(category as Category);
  }
  if (hits.size !== 1) return null;
  return [...hits][0] ?? null;
}
