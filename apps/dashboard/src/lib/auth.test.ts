import { memoryAdapter } from 'better-auth/adapters/memory';
import { describe, expect, it, vi } from 'vitest';

import { createAuth } from './auth';

const setup = async () => {
  const data: Record<string, Record<string, unknown>[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
  };
  const auth = createAuth(memoryAdapter(data), {
    allowedEmails: 'owner@example.com',
    baseURL: 'http://localhost:3000',
    secret: 'a-fake-secret-for-tests-only-0123456789',
    googleClientId: 'fake-id',
    googleClientSecret: 'fake-secret',
  });
  return { auth, context: await auth.$context, data };
};

const SOURCE = {
  method: 'oauth',
  oauth: { providerId: 'google', profile: {} },
} as const;

const newUser = (email: string, emailVerified = true) => ({
  email,
  emailVerified,
  name: 'Fake Name',
});

describe('creating a user', () => {
  it('works for the allowlisted, verified email', async () => {
    const { context, data } = await setup();
    await context.internalAdapter.createUser(
      newUser('owner@example.com'),
      SOURCE,
    );
    expect(data.user).toHaveLength(1);
  });

  it('is rejected with a code for any other email, and writes no row', async () => {
    const { context, data } = await setup();
    await expect(
      context.internalAdapter.createUser(newUser('other@example.com'), SOURCE),
    ).rejects.toMatchObject({ body: { code: 'NOT_ALLOWED' } });
    expect(data.user).toEqual([]);
  });

  it('is rejected for an unverified email, and writes no row', async () => {
    const { context, data } = await setup();
    await expect(
      context.internalAdapter.createUser(
        newUser('owner@example.com', false),
        SOURCE,
      ),
    ).rejects.toMatchObject({ body: { code: 'NOT_ALLOWED' } });
    expect(data.user).toEqual([]);
  });
});

describe('the OAuth callback', () => {
  it.each([
    ['no state', 'code=x'],
    ['a forged state', 'code=x&state=forged'],
  ])(
    'with %s creates nothing and sends you to sign-in',
    async (_name, query) => {
      const { auth, data } = await setup();
      const response = await auth.handler(
        new Request(`http://localhost:3000/api/auth/callback/google?${query}`),
      );
      expect(response.status).toBe(302);
      expect(new URL(response.headers.get('location')!).pathname).toBe(
        '/sign-in',
      );
      expect(data.user).toEqual([]);
      expect(data.session).toEqual([]);
    },
  );
});

describe('Google sign-in', () => {
  it('starts with a state cookie and PKCE, and asks only for basic scopes', async () => {
    const { auth } = await setup();
    const response = await auth.api.signInSocial({
      body: { provider: 'google', callbackURL: '/' },
    });
    const url = new URL(response.url!);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/api/auth/callback/google',
    );
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('scope')?.split(' ').sort()).toEqual([
      'email',
      'openid',
      'profile',
    ]);
  });
});

describe('BETTER_AUTH_URL with a trailing slash', () => {
  it('still sends a failed callback to /sign-in', async () => {
    const auth = createAuth(
      memoryAdapter({ user: [], session: [], account: [], verification: [] }),
      {
        allowedEmails: 'owner@example.com',
        baseURL: 'http://localhost:3000/',
        secret: 'a-fake-secret-for-tests-only-0123456789',
        googleClientId: 'fake-id',
        googleClientSecret: 'fake-secret',
      },
    );
    const response = await auth.handler(
      new Request('http://localhost:3000/api/auth/callback/google?code=x'),
    );
    expect(new URL(response.headers.get('location')!).pathname).toBe(
      '/sign-in',
    );
  });
});

describe('Better Auth logging', () => {
  it('prints fixed text: its messages can hold query parameters', async () => {
    const { auth } = await setup();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = auth.options.logger.log as (
      level: string,
      ...args: string[]
    ) => void;
    log('error', 'params: fake-session-token');
    expect(logged.mock.calls).toEqual([['better-auth: error']]);
    logged.mockRestore();
  });
});

describe('options that are easy to lose', () => {
  it('keeps the settings this app depends on', async () => {
    const { auth } = await setup();
    const { options } = auth;
    expect(options.account?.encryptOAuthTokens).toBe(true);
    expect(options.session?.disableSessionRefresh).toBe(true);
    expect(options.telemetry?.enabled).toBe(false);
  });
});
