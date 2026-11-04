import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Accounts from './accounts/page';
import Overview from './page';
import Spending from './spending/page';
import { type Dashboard } from '../lib/data';

import type { ReactElement } from 'react';

// The pages render on the server, so this is the HTML the browser gets. Fake data only.
const mocks = vi.hoisted(() => ({ loadPage: vi.fn() }));

vi.mock('../lib/page', () => ({ loadPage: mocks.loadPage }));
vi.mock('./actions', () => ({ signOut: vi.fn() }));

const OCTOBER = { year: 2026, month: 10 };
const SEPTEMBER = { year: 2026, month: 9 };
const NO_FLOW = { in: 0n, out: 0n, net: 0n, adjustments: 0n };

const dashboard = (overrides: Partial<Dashboard>): Dashboard => ({
  spend: [],
  cashFlow: NO_FLOW,
  savingsRate: null,
  invested: 0n,
  history: [],
  balances: [],
  people: { owesMe: [], owesMeTotal: 0n, iOwe: [], iOweTotal: 0n },
  ...overrides,
});

const render = async (
  page: (props: never) => Promise<ReactElement>,
  data: Dashboard,
) => {
  mocks.loadPage.mockResolvedValue({ month: OCTOBER, isCurrent: true, data });
  return renderToStaticMarkup(await page({} as never));
};

beforeEach(() => vi.resetAllMocks());

describe('Overview', () => {
  it('shows Invested for the month', async () => {
    const html = await render(Overview, dashboard({ invested: 1_000_000n }));
    expect(html).toContain('>Invested<');
    expect(html).toContain('₹10,000');
    expect(html).not.toContain('+₹10,000');
  });

  it('shows a month where more came out as negative', async () => {
    const html = await render(Overview, dashboard({ invested: -300_000n }));
    expect(html).toContain('−₹3,000');
  });
});

describe('Spending', () => {
  it('does not blank a month whose only activity is investing', async () => {
    const html = await render(
      Spending,
      dashboard({
        history: [
          { month: OCTOBER, cashFlow: NO_FLOW, invested: 500_000n },
          { month: SEPTEMBER, cashFlow: NO_FLOW, invested: 0n },
        ],
      }),
    );
    expect(html).toContain('>Invested<');
    expect(html).toContain('₹5,000');
    // October shows its zeros; only September is blank, in all four columns.
    expect(html.match(/—/g)).toHaveLength(4);
  });
});

describe('Accounts', () => {
  it('lists investments, and says the balance is not what they are worth', async () => {
    const html = await render(
      Accounts,
      dashboard({
        balances: [
          {
            kind: 'INVESTMENT',
            accounts: [
              { name: 'MFALPHA', amount: 2_500_000n },
              { name: 'STOCKS', amount: -200_000n },
            ],
            total: 2_300_000n,
          },
        ],
      }),
    );
    expect(html).toContain('Investments');
    expect(html).toContain('Invested so far');
    expect(html).toContain('MFALPHA');
    expect(html).toContain('−₹2,000');
    expect(html).toContain('not what these are');
  });

  it('shows no investment note without investment accounts', async () => {
    const html = await render(
      Accounts,
      dashboard({
        balances: [
          {
            kind: 'BANK',
            accounts: [{ name: 'BOM', amount: 100n }],
            total: 100n,
          },
        ],
      }),
    );
    expect(html).not.toContain('Investments');
    expect(html).not.toContain('not what these are');
  });
});
