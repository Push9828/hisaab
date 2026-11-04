import { ingest } from '@hisaab/core';

import { isLocalDatabaseUrl } from '../src/database-url';
import { DrizzleStore, type Db } from '../src/drizzle-store';
import { processedMessages } from '../src/schema';

// All names and numbers are fake. Used for portfolio screenshots and to try the
// dashboard, and only ever on a local database of its own.

const DEMO_DATABASE = 'hisaab_demo';

// Fixed, so the screenshots repeat and undated entries land on the same day.
const RECEIVED_AT = new Date('2026-10-31T12:00:00Z');

const everyMonth = (m: string) => [
  `on 1 ${m} 2026 in 85k salary icici`,
  `on 3 ${m} 2026 xfer 40k icici bom`,
  `on 5 ${m} 2026 emi 32k bom`,
  `on 6 ${m} 2026 rent 15k icici`,
  `on 8 ${m} 2026 groceries 4k cc icici`,
  `on 10 ${m} 2026 petrol 3k cc icici`,
  `on 12 ${m} 2026 netflix 500 cc icici`,
  `on 15 ${m} 2026 pay icicicc 7500 from icici`,
];

export const FAKE_MESSAGES = [
  'open icici 1l bank',
  'open bom 50k bank',
  'open icicicc 0 cc',
  'open homeloan 25l loan',
  'open rahul 0 receivable',
  'open anita 0 receivable',
  'open ravi 3000 payable',
  ...everyMonth('aug'),
  'on 20 aug 2026 swiggy 800 cc icici',
  ...everyMonth('sep'),
  'on 18 sep 2026 dinner 4000 split rahul 1000 anita 1000 cc icici',
  'on 22 sep 2026 lend rahul 10k icici',
  ...everyMonth('oct'),
  'on 9 oct 2026 got rahul 5k icici',
  // No keyword matches, so this shows the Uncategorised row.
  'on 25 oct 2026 misc stuff 700 bom',
  'bal icici 163000',
  // Appended, because each message's id is its index: moving one would replay it.
  'open mfalpha 0 investment',
  'open mfbeta 20k investment',
  'open stocks 0 investment',
  'on 4 aug 2026 xfer 10k icici mfalpha',
  'on 4 sep 2026 xfer 10k icici mfalpha',
  'on 4 sep 2026 xfer 5k icici stocks',
  'on 4 oct 2026 xfer 10k icici mfalpha',
  'on 11 oct 2026 xfer 5k mfalpha mfbeta',
  'on 20 oct 2026 xfer 3k stocks icici',
];

/** The same database server, under a database that holds nothing else. Refuses anything not local. */
export function demoDatabaseUrl(url: string): URL {
  if (!isLocalDatabaseUrl(url)) {
    throw new Error('Refusing to seed: DATABASE_URL is not a local database');
  }
  return Object.assign(new URL(url), { pathname: `/${DEMO_DATABASE}` });
}

/** Through `ingest`, as the bot does. Fixed ids make a second run a no-op. */
export async function seedFake(db: Db): Promise<void> {
  const store = new DrizzleStore(db);
  for (const [i, text] of FAKE_MESSAGES.entries()) {
    await ingest(
      { channel: 'seed', externalId: `fake-${i}`, text, now: RECEIVED_AT },
      store,
    );
  }
  // A message that became a clarifying question writes nothing, silently.
  const written = await db.$count(processedMessages);
  if (written !== FAKE_MESSAGES.length) {
    throw new Error(
      `Seed incomplete: ${written} of ${FAKE_MESSAGES.length} written`,
    );
  }
}
