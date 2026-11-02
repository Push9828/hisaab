import 'server-only';

import { authSchema } from '@hisaab/db';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';

import { isAllowed } from './allowlist';
import { getDb } from './db';
import { requiredEnv } from './env';

const SESSION_DAYS = 7;

type AuthEnv = {
  allowedEmails: string;
  baseURL: string;
  secret: string;
  googleClientId: string;
  googleClientSecret: string;
};

const withoutIdToken = <T extends object>(account: T) =>
  ({ ...account, idToken: null }) as T;

export function createAuth(
  database: BetterAuthOptions['database'],
  env: AuthEnv,
) {
  return betterAuth({
    database,
    baseURL: env.baseURL,
    secret: env.secret,
    telemetry: { enabled: false },
    // Fixed text. Its messages can hold query parameters, such as a session token.
    logger: {
      level: 'error',
      log: (level) => console.error(`better-auth: ${level}`),
    },
    socialProviders: {
      google: {
        clientId: env.googleClientId,
        clientSecret: env.googleClientSecret,
        prompt: 'select_account',
      },
    },
    account: {
      // Sign-in is the only thing Google is used for, but it still returns tokens.
      encryptOAuthTokens: true,
      // In an encrypted cookie, so an anonymous sign-in click writes no database row.
      storeStateStrategy: 'cookie',
      // One provider and one person: a different Google account is never the owner.
      accountLinking: { enabled: false },
    },
    session: {
      // A fixed lifetime. Refreshing would write during reads, and a page
      // render cannot set the new cookie anyway.
      expiresIn: SESSION_DAYS * 24 * 60 * 60,
      disableSessionRefresh: true,
    },
    // `errorURL` is the fallback for a callback that fails before its state is read.
    // `throw` sends unexpected errors to the route's catch. Without it, the router
    // prints them, and a failed query's message holds its parameters.
    onAPIError: {
      errorURL: new URL('/sign-in', env.baseURL).toString(),
      throw: true,
    },
    databaseHooks: {
      // encryptOAuthTokens leaves the id token in clear, and it holds the owner's
      // email and name. Nothing uses it, so it is not kept.
      account: {
        create: {
          before: async (account) => ({ data: withoutIdToken(account) }),
        },
        update: {
          before: async (account) => ({ data: withoutIdToken(account) }),
        },
      },
      user: {
        create: {
          before: async (user) => {
            if (!isAllowed(user, env.allowedEmails)) {
              throw new APIError('FORBIDDEN', { code: 'NOT_ALLOWED' });
            }
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

let auth: ReturnType<typeof createAuth> | undefined;

/** Created on first use, so a build needs no env. */
export function getAuth() {
  auth ??= createAuth(
    drizzleAdapter(getDb(), {
      provider: 'pg',
      schema: {
        user: authSchema.user,
        session: authSchema.session,
        account: authSchema.account,
        verification: authSchema.verification,
      },
    }),
    {
      allowedEmails: requiredEnv('ALLOWED_EMAILS'),
      baseURL: requiredEnv('BETTER_AUTH_URL'),
      secret: requiredEnv('BETTER_AUTH_SECRET'),
      googleClientId: requiredEnv('GOOGLE_CLIENT_ID'),
      googleClientSecret: requiredEnv('GOOGLE_CLIENT_SECRET'),
    },
  );
  return auth;
}
