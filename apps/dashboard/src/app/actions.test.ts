import { inspect } from 'node:util';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { signIn, signOut } from './actions';

const SECRET = 'params: fake-session-token';

const mocks = vi.hoisted(() => ({
  signInSocial: vi.fn(),
  revokeSessions: vi.fn(),
  signOut: vi.fn(),
  requireOwner: vi.fn(),
}));

class Redirect extends Error {
  constructor(readonly to: string) {
    super(`redirected ${to}`);
  }
}

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
  unstable_rethrow: (e: unknown) => {
    if (e instanceof Redirect) throw e;
  },
}));
vi.mock('../lib/owner', () => ({ requireOwner: mocks.requireOwner }));
vi.mock('../lib/auth', () => ({
  getAuth: () => ({
    api: {
      signInSocial: mocks.signInSocial,
      revokeSessions: mocks.revokeSessions,
      signOut: mocks.signOut,
    },
  }),
}));

const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

const expectNoSecretLogged = () => {
  // Not JSON.stringify: it turns an Error into {}, hiding the message.
  expect(inspect(logged.mock.calls, { depth: null })).not.toContain(SECRET);
  expect(logged).toHaveBeenCalled();
};

beforeEach(() => {
  vi.resetAllMocks();
  logged.mockImplementation(() => {});
  mocks.requireOwner.mockResolvedValue({});
});

describe('signIn', () => {
  it('redirects to Google', async () => {
    mocks.signInSocial.mockResolvedValue({
      url: 'https://accounts.google.com/x',
    });
    await expect(signIn()).rejects.toMatchObject({
      to: 'https://accounts.google.com/x',
    });
    expect(mocks.signInSocial).toHaveBeenCalledWith({
      body: {
        provider: 'google',
        callbackURL: '/',
        errorCallbackURL: '/sign-in',
      },
    });
  });

  it('on failure shows the fixed message and logs no details', async () => {
    mocks.signInSocial.mockRejectedValue(new Error(SECRET));
    await expect(signIn()).rejects.toMatchObject({ to: '/sign-in?error=1' });
    expectNoSecretLogged();
  });
});

describe('signOut', () => {
  it('ends every session, then the cookie', async () => {
    await expect(signOut()).rejects.toMatchObject({ to: '/sign-in' });
    expect(mocks.revokeSessions).toHaveBeenCalledOnce();
    expect(mocks.signOut).toHaveBeenCalledOnce();
    // The other way round, signOut deletes the session and revoking then fails.
    expect(mocks.revokeSessions.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.signOut.mock.invocationCallOrder[0]!,
    );
  });

  it('lets the requireOwner redirect through', async () => {
    mocks.requireOwner.mockRejectedValue(new Redirect('/sign-in'));
    await expect(signOut()).rejects.toMatchObject({ to: '/sign-in' });
    expect(mocks.revokeSessions).not.toHaveBeenCalled();
    expect(logged).not.toHaveBeenCalled();
  });

  it('on failure does not claim success, and logs no details', async () => {
    mocks.revokeSessions.mockRejectedValue(new Error(SECRET));
    await expect(signOut()).rejects.toMatchObject({ to: '/' });
    expectNoSecretLogged();
  });
});
