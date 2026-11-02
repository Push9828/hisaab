'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getAuth } from '../lib/auth';
import { requireOwner } from '../lib/owner';

export async function signIn() {
  const { url } = await getAuth().api.signInSocial({
    body: {
      provider: 'google',
      callbackURL: '/',
      errorCallbackURL: '/sign-in',
    },
  });
  if (!url) throw new Error('No Google sign-in URL');
  redirect(url);
}

/** Signs out every device: with one user, a lost laptop is the reason to sign out. */
export async function signOut() {
  await requireOwner();
  const requestHeaders = await headers();
  await getAuth().api.revokeSessions({ headers: requestHeaders });
  await getAuth().api.signOut({ headers: requestHeaders });
  redirect('/sign-in');
}
