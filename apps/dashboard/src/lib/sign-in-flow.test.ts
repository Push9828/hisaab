import { memoryAdapter } from 'better-auth/adapters/memory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAuth } from './auth';

// The real Better Auth code from sign-in to session, with a fake Google. Fake data only.
const BASE = 'http://localhost:3000';
const FAKE_TOKEN = 'params: fake-session-token';

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

type Rows = Record<
  'user' | 'session' | 'account' | 'verification',
  Record<string, unknown>[]
>;
type Claims = Record<string, unknown>;

let claims: Claims;
let logged: unknown[][];

const setup = (failOn?: string) => {
  const data: Rows = { user: [], session: [], account: [], verification: [] };
  const memory = memoryAdapter(data);
  const database: typeof memory = (options) => {
    const adapter = memory(options);
    return {
      ...adapter,
      create: (async (args: { model: string }) => {
        if (args.model === failOn)
          throw new Error(`Failed query\n${FAKE_TOKEN}`);
        return (adapter.create as (a: unknown) => Promise<unknown>)(args);
      }) as typeof adapter.create,
    };
  };
  const auth = createAuth(database, {
    allowedEmails: 'owner@example.com',
    baseURL: BASE,
    secret: 'a-fake-secret-for-tests-only-0123456789',
    googleClientId: 'fake-id',
    googleClientSecret: 'fake-secret',
  });
  return { auth, data };
};

const signIn = async (auth: ReturnType<typeof setup>['auth']) => {
  const started = await auth.api.signInSocial({
    body: {
      provider: 'google',
      callbackURL: '/',
      errorCallbackURL: '/sign-in',
    },
    returnHeaders: true,
  });
  const state = new URL(started.response.url!).searchParams.get('state')!;
  const cookie = started.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  return auth.handler(
    new Request(`${BASE}/api/auth/callback/google?code=c&state=${state}`, {
      headers: { cookie },
    }),
  );
};

beforeEach(() => {
  claims = {
    sub: 'google-1',
    email: 'owner@example.com',
    email_verified: true,
    name: 'Fake Owner',
  };
  logged = [];
  vi.spyOn(console, 'error').mockImplementation((...args) => {
    logged.push(args);
  });
  vi.stubGlobal('fetch', async () =>
    Response.json({
      access_token: 'fake-access-token',
      id_token: `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`,
      token_type: 'Bearer',
      expires_in: 3600,
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('signing in with Google', () => {
  it('gives the owner a session', async () => {
    const { auth, data } = setup();
    const response = await signIn(auth);
    expect(new URL(response.headers.get('location')!, BASE).pathname).toBe('/');
    expect(data.user).toHaveLength(1);
    expect(data.session).toHaveLength(1);
  });

  it.each([
    ['another email', { email: 'other@example.com' }],
    ['an unverified email', { email_verified: false }],
    ['a missing verified flag', { email_verified: undefined }],
    ['the string "false" as the verified flag', { email_verified: 'false' }],
  ])('rejects %s and writes no user or session', async (_name, change) => {
    Object.assign(claims, change);
    const { auth, data } = setup();
    const response = await signIn(auth);
    const location = new URL(response.headers.get('location')!, BASE);
    expect(location.pathname).toBe('/sign-in');
    expect(location.searchParams.has('error')).toBe(true);
    expect(data.user).toEqual([]);
    expect(data.session).toEqual([]);
  });

  it('does not link a different Google account claiming the same email', async () => {
    const { auth, data } = setup();
    await signIn(auth);
    claims.sub = 'google-2';
    const response = await signIn(auth);
    expect(new URL(response.headers.get('location')!, BASE).pathname).toBe(
      '/sign-in',
    );
    expect(data.account).toHaveLength(1);
    expect(data.session).toHaveLength(1);
  });
});

describe('what sign-in stores', () => {
  it('writes nothing to the database until Google has answered', async () => {
    const { auth, data } = setup();
    for (let i = 0; i < 25; i++) {
      await auth.api.signInSocial({
        body: { provider: 'google', callbackURL: '/' },
      });
    }
    expect(data.verification).toEqual([]);
  });

  it('encrypts the access token and keeps no id token', async () => {
    const { auth, data } = setup();
    await signIn(auth);
    const [account] = data.account;
    expect(account?.accessToken).not.toBe('fake-access-token');
    expect(account?.accessToken).toBeTruthy();
    expect(account?.idToken).toBeNull();
  });

  it('keeps no id token on later sign-ins either', async () => {
    const { auth, data } = setup();
    await signIn(auth);
    await signIn(auth);
    expect(data.account).toHaveLength(1);
    expect(data.account[0]?.idToken).toBeNull();
  });
});

describe('a database failure during sign-in', () => {
  it('reaches the route catch, and prints no query parameters', async () => {
    const { auth } = setup('session');
    await expect(signIn(auth)).rejects.toThrow();
    expect(JSON.stringify(logged)).not.toContain('fake-session-token');
  });
});
