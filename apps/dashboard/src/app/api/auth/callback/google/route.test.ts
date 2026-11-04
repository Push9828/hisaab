import { inspect } from 'node:util';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const handler = vi.hoisted(() => vi.fn());

vi.mock('../../../../../lib/auth', () => ({ getAuth: () => ({ handler }) }));
vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000');

const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
const request = new Request('http://localhost:3000/api/auth/callback/google');

beforeEach(() => {
  handler.mockReset();
  logged.mockClear();
});

describe('GET callback', () => {
  it('returns what Better Auth returns', async () => {
    const response = new Response(null, { status: 302 });
    handler.mockResolvedValue(response);
    expect(await GET(request)).toBe(response);
  });

  it('on failure sends you to sign-in and logs no details', async () => {
    handler.mockRejectedValue(new Error('params: fake-session-token'));
    const response = await GET(request);
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/sign-in?error=1',
    );
    // Not JSON.stringify: it turns an Error into {}, hiding the message.
    expect(inspect(logged.mock.calls, { depth: null })).not.toContain(
      'fake-session',
    );
    expect(logged).toHaveBeenCalled();
  });
});
