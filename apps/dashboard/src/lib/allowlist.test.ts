import { describe, expect, it } from 'vitest';

import { isAllowed } from './allowlist';

const verified = (email: string) => ({ email, emailVerified: true });

describe('isAllowed', () => {
  it('allows a verified email on the list', () => {
    expect(isAllowed(verified('owner@example.com'), 'owner@example.com')).toBe(
      true,
    );
  });

  it('denies an email not on the list', () => {
    expect(isAllowed(verified('other@example.com'), 'owner@example.com')).toBe(
      false,
    );
  });

  it('denies an unverified email, even on the list', () => {
    expect(
      isAllowed(
        { email: 'owner@example.com', emailVerified: false },
        'owner@example.com',
      ),
    ).toBe(false);
  });

  it('ignores case on both sides', () => {
    expect(isAllowed(verified('Owner@Example.com'), 'OWNER@example.COM')).toBe(
      true,
    );
  });

  it('ignores whitespace around list entries', () => {
    expect(
      isAllowed(
        verified('owner@example.com'),
        ' first@example.com , owner@example.com ',
      ),
    ).toBe(true);
  });

  it.each(['', '   ', ',', ' , , '])('list %j denies everyone', (list) => {
    expect(isAllowed(verified('owner@example.com'), list)).toBe(false);
    expect(isAllowed(verified(''), list)).toBe(false);
  });

  it('requires the verified flag to be exactly true', () => {
    const user = { email: 'owner@example.com', emailVerified: 'false' };
    expect(
      isAllowed(
        user as unknown as Parameters<typeof isAllowed>[0],
        'owner@example.com',
      ),
    ).toBe(false);
  });

  it('rejects a non-ASCII email that lowercases to an allowed one', () => {
    // U+212A KELVIN SIGN lowercases to k.
    expect(
      isAllowed(verified('\u212Aate@example.com'), 'kate@example.com'),
    ).toBe(false);
  });

  it('does not match on part of an address', () => {
    expect(
      isAllowed(verified('owner@example.com.evil.test'), 'owner@example.com'),
    ).toBe(false);
    expect(isAllowed(verified('example.com'), 'owner@example.com')).toBe(false);
  });
});
