'use server';

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { getAuth } from '../lib/auth';
import { requireOwner } from '../lib/owner';

// Errors stay caught here and logged as fixed text: Next would print them, and
// a failed query's message holds its parameters, such as a session token.

export async function signIn() {
  let url: string | undefined;
  try {
    ({ url } = await getAuth().api.signInSocial({
      body: {
        provider: 'google',
        callbackURL: '/',
        errorCallbackURL: '/sign-in',
      },
    }));
  } catch {
    console.error('dashboard: sign-in failed');
  }
  redirect(url ?? '/sign-in?error=1');
}

/** Signs out every device: with one user, a lost laptop is the reason to sign out. */
export async function signOut() {
  try {
    await requireOwner();
    const requestHeaders = await headers();
    await getAuth().api.revokeSessions({ headers: requestHeaders });
    await getAuth().api.signOut({ headers: requestHeaders });
  } catch (e) {
    unstable_rethrow(e);
    console.error('dashboard: sign-out failed');
    redirect('/');
  }
  redirect('/sign-in');
}
