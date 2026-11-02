import 'server-only';

import {
  createDb,
  isLocalDatabaseUrl,
  SUPABASE_ROOT_CA,
  type Db,
} from '@hisaab/db';

import { requiredEnv } from './env';

const IDLE_TIMEOUT_MS = 5_000;

let db: Db | undefined;

/** One connection is enough for one user. Created on first use, so a build needs no env. */
export function getDb(): Db {
  if (!db) {
    const url = requiredEnv('DATABASE_URL');
    const created = createDb(url, {
      max: 1,
      idleTimeoutMillis: IDLE_TIMEOUT_MS,
      // Local Docker has no TLS. Anything else must verify Supabase's certificate.
      ...(!isLocalDatabaseUrl(url) && { ca: SUPABASE_ROOT_CA }),
    });
    // Without a listener, a dropped idle connection crashes the process.
    created.pool.on('error', () =>
      console.error('dashboard: idle connection failed'),
    );
    db = created.db;
  }
  return db;
}
