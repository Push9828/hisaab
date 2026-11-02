import { describe, expect, it } from 'vitest';

import { assertTestDatabaseUrl } from './test-db';

describe('assertTestDatabaseUrl', () => {
  it('accepts a local database ending in _test', () => {
    expect(
      assertTestDatabaseUrl('postgresql://u:p@localhost:5433/hisaab_test')
        .pathname,
    ).toBe('/hisaab_test');
  });

  it('refuses another name', () => {
    expect(() =>
      assertTestDatabaseUrl('postgresql://u:p@localhost:5433/hisaab'),
    ).toThrow('_test');
  });

  // Test setup changes a server-wide role's password, so a hosted server must never get this far.
  it('refuses a hosted server, even with a _test database name', () => {
    expect(() =>
      assertTestDatabaseUrl(
        'postgresql://u:p@aws-0-ap-south-1.pooler.supabase.com:5432/hisaab_test',
      ),
    ).toThrow('local');
  });
});
