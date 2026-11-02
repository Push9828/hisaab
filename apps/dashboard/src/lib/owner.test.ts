import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requireOwner } from './owner';

const getSession = vi.hoisted(() => vi.fn());
const REDIRECT = 'redirected';

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`${REDIRECT} ${to}`);
  },
}));
vi.mock('./auth', () => ({ getAuth: () => ({ api: { getSession } }) }));

const session = (email: string, emailVerified = true) => ({
  user: { email, emailVerified },
});

beforeEach(() => {
  getSession.mockReset();
  vi.stubEnv('ALLOWED_EMAILS', 'owner@example.com');
});

describe('requireOwner', () => {
  it('returns the user for the owner', async () => {
    getSession.mockResolvedValue(session('owner@example.com'));
    await expect(requireOwner()).resolves.toMatchObject({
      email: 'owner@example.com',
    });
  });

  it('redirects with no session', async () => {
    getSession.mockResolvedValue(null);
    await expect(requireOwner()).rejects.toThrow(`${REDIRECT} /sign-in`);
  });

  it('redirects a valid session whose email has left the allowlist', async () => {
    getSession.mockResolvedValue(session('former@example.com'));
    await expect(requireOwner()).rejects.toThrow(`${REDIRECT} /sign-in`);
  });

  it('redirects an unverified email', async () => {
    getSession.mockResolvedValue(session('owner@example.com', false));
    await expect(requireOwner()).rejects.toThrow(`${REDIRECT} /sign-in`);
  });

  it('fails closed when ALLOWED_EMAILS is not set', async () => {
    vi.stubEnv('ALLOWED_EMAILS', undefined);
    getSession.mockResolvedValue(session('owner@example.com'));
    await expect(requireOwner()).rejects.toThrow('ALLOWED_EMAILS');
  });
});
