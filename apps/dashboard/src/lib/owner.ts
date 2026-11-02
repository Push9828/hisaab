import 'server-only';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { isAllowed } from './allowlist';
import { getAuth } from './auth';
import { requiredEnv } from './env';

/**
 * The gate. Every server read calls this first (SPEC section 9): it checks the
 * session and the allowlist each time, so removing an email takes effect at once.
 */
export async function requireOwner() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session || !isAllowed(session.user, requiredEnv('ALLOWED_EMAILS'))) {
    redirect('/sign-in');
  }
  return session.user;
}
