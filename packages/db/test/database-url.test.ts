import { describe, expect, it } from 'vitest';

import { createDb, parseDatabaseUrl } from '../src';

// Fake credentials and hosts throughout.
const BASE = 'postgresql://u:fake-pw@db.invalid:5432/x';

describe('parseDatabaseUrl', () => {
  it('accepts a plain URL, including a password containing "&ssl"', () => {
    expect(parseDatabaseUrl(BASE).hostname).toBe('db.invalid');
    const tricky = 'postgresql://u:a%26sslb@db.invalid:5432/x';
    expect(parseDatabaseUrl(tricky).password).toBe('a%26sslb');
  });

  it.each([
    ['?sslmode=disable', 'sslmode'],
    ['?a=1&sslrootcert=x', 'sslrootcert'],
    ['?SSL=true', 'ssl'],
    ['?%73slmode=disable', 'sslmode'], // %73 is "s"; pg decodes names
    ['?host=elsewhere.invalid', 'host'],
    ['?port=6543', 'port'],
  ])('rejects %s (pg would act on it)', (query, key) => {
    expect(() => parseDatabaseUrl(`${BASE}${query}`)).toThrow(
      `must not set the ${key} parameter`,
    );
  });

  it('an invalid URL error never contains the URL', () => {
    const bad = 'postgresql://u:pa#ss@/x';
    let message = '';
    try {
      parseDatabaseUrl(bad);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('not a valid URL');
    expect(message).not.toContain('pa#ss');
  });

  it('createDb applies the same check', () => {
    expect(() => createDb(`${BASE}?%73slmode=disable`, { ca: 'fake' })).toThrow(
      'must not set the sslmode parameter',
    );
  });
});
