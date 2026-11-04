import { describe, expect, it } from 'vitest';

import { ACCOUNTS, ctx } from './fixtures';
import { interpret } from './interpret';
import { reply } from './reply';

const say = (text: string) => reply(interpret(text, ctx()), ctx());

describe('reply', () => {
  it('confirms an expense in the SPEC format', () => {
    expect(say('petrol 4k cc icici')).toBe(
      'Logged: 4,000 Petrol (Transport) on ICICI-CC. Reply "undo" to revert.',
    );
  });

  it('shows paise only when non-zero', () => {
    expect(say('petrol 450.50 icici')).toContain('450.50 Petrol');
  });

  it('flags a missing category', () => {
    expect(say('mystery 500 icici')).toBe(
      'Logged: 500 Mystery (category needs review) on ICICI. Reply "undo" to revert.',
    );
  });

  it('confirms income', () => {
    expect(say('in 85k salary icici')).toBe(
      'Logged: 85,000 Salary (Salary) into ICICI. Reply "undo" to revert.',
    );
  });

  it('confirms a transfer', () => {
    expect(say('xfer 25k icici bom')).toBe(
      'Logged: transfer 25,000 from ICICI to BOM. Reply "undo" to revert.',
    );
    expect(say('pay icicicc 4k from icici')).toBe(
      'Logged: transfer 4,000 from ICICI to ICICI-CC. Reply "undo" to revert.',
    );
  });

  it('confirms a split with every share', () => {
    expect(say('dinner 4000 split john 1000 sam 1000 cc icici')).toBe(
      'Logged: 4,000 Dinner (Food) on ICICI-CC. Your share 2,000; John owes 1,000, Sam owes 1,000. Reply "undo" to revert.',
    );
  });

  it('states the difference on reconcile', () => {
    expect(say('bal icici 85000')).toBe(
      'Adjusted ICICI +800 (was 84,200, now 85,000). Reply "undo" to revert.',
    );
    expect(say('bal icicicc 2000')).toBe(
      'Adjusted ICICI-CC -500 (was -1,500, now -2,000). Reply "undo" to revert.',
    );
  });

  it('says when nothing needed adjusting', () => {
    expect(say('bal icici 84200')).toBe('ICICI already matches 84,200.');
  });

  it('mentions the date only when backdated', () => {
    expect(say('on 20 oct petrol 4k icici')).toBe(
      'Logged: 4,000 Petrol (Transport) on ICICI. Dated 20 Oct. Reply "undo" to revert.',
    );
    expect(say('today petrol 4k icici')).not.toContain('Dated');
  });

  it('lists balances', () => {
    expect(say('accounts')).toBe(
      [
        'ICICI: 84,200',
        'ICICI-CC: -1,500',
        'BOM: 50,000',
        'John: 0',
        'Sam: 0',
      ].join('\n'),
    );
  });

  it('never replies with empty text when there are no accounts', () => {
    // Telegram rejects an empty sendMessage, so the user would see nothing.
    const empty = ctx([]);
    for (const text of ['accounts', 'bal']) {
      expect(reply(interpret(text, empty), empty)).toBe(
        'No accounts yet. Add one: open <alias> <amount> <kind>',
      );
    }
  });

  it('confirms an opened account', () => {
    expect(say('open hdfc 50000 bank')).toBe(
      'Opened HDFC (BANK) with balance 50,000.',
    );
  });

  it('asks the clarifying question', () => {
    expect(say('petrol 4k')).toContain('Which account?');
  });

  it('never leaks account ids', () => {
    for (const a of ACCOUNTS) {
      expect(say(`petrol 4k ${a.alias}`)).not.toContain(a.id);
    }
  });
});
