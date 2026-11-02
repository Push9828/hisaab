import { formatInr, type AccountKind, type NamedAmount } from '@hisaab/core';
import { unstable_rethrow } from 'next/navigation';

import { signOut } from './actions';
import { barPercent } from '../lib/bar';
import { loadDashboard } from '../lib/data';
import {
  monthLabel,
  monthParam,
  selectedMonth,
  shiftMonth,
} from '../lib/month';

export const dynamic = 'force-dynamic';

const KIND_LABELS: Partial<Record<AccountKind, string>> = {
  BANK: 'Bank accounts',
  CREDIT_CARD: 'Credit cards (owed)',
  LOAN: 'Loans (owed)',
};

const load = async (month: Parameters<typeof loadDashboard>[0]) => {
  try {
    return await loadDashboard(month);
  } catch (e) {
    // Lets requireOwner's redirect through. Fixed text: an error can hold query details.
    unstable_rethrow(e);
    console.error('dashboard: could not load');
    return null;
  }
};

function Amounts({
  title,
  rows,
  total,
}: {
  title: string;
  rows: readonly NamedAmount[];
  total: bigint;
}) {
  return (
    <table>
      <caption>{title}</caption>
      <tbody>
        {rows.map((row) => (
          <tr key={row.name}>
            <th scope="row">{row.name}</th>
            <td>{formatInr(row.amount)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">Total</th>
          <td>{formatInr(total)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ month?: string | string[] }>;
}) {
  const now = new Date();
  const month = selectedMonth((await searchParams).month, now);
  const current = selectedMonth(undefined, now);
  const isCurrent = monthParam(month) === monthParam(current);
  const data = await load(month);

  if (!data) {
    return (
      <main>
        <h1>Hisaab</h1>
        <p role="alert">The dashboard could not load. Reload to try again.</p>
      </main>
    );
  }

  const largest = data.spend[0]?.total ?? 0n;
  const spendTotal = data.cashFlow.out;

  return (
    <main>
      <header>
        <h1>Hisaab</h1>
        <form action={signOut}>
          <button type="submit">Sign out everywhere</button>
        </form>
      </header>

      <nav aria-label="Month">
        <a href={`/?month=${monthParam(shiftMonth(month, -1))}`}>Previous</a>
        <h2>{monthLabel(month)}</h2>
        {isCurrent ? (
          <span />
        ) : (
          <a href={`/?month=${monthParam(shiftMonth(month, 1))}`}>Next</a>
        )}
      </nav>

      <section aria-labelledby="flow" className="tiles">
        <h3 id="flow" className="hidden">
          Cash flow
        </h3>
        <dl>
          <div>
            <dt>In</dt>
            <dd>{formatInr(data.cashFlow.in)}</dd>
          </div>
          <div>
            <dt>Out</dt>
            <dd>{formatInr(data.cashFlow.out)}</dd>
          </div>
          <div>
            <dt>Net</dt>
            <dd>{formatInr(data.cashFlow.net)}</dd>
          </div>
        </dl>
        {data.cashFlow.adjustments !== 0n && (
          <p className="note">
            Reconcile corrections, not counted in net:{' '}
            {formatInr(data.cashFlow.adjustments)}
          </p>
        )}
      </section>

      <section aria-labelledby="spend">
        <h3 id="spend">Spend by category</h3>
        {data.spend.length === 0 ? (
          <p className="note">No spending this month.</p>
        ) : (
          <table className="bars">
            <tbody>
              {data.spend.map((row) => (
                <tr key={row.category}>
                  <th scope="row">{row.category}</th>
                  <td className="bar">
                    {/* An attribute, not a style: the CSP blocks inline styles. */}
                    <svg aria-hidden="true" width="100%" height="8">
                      <rect
                        width={barPercent(row.total, largest)}
                        height="8"
                        rx="4"
                      />
                    </svg>
                  </td>
                  <td>{formatInr(row.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td />
                <td>{formatInr(spendTotal)}</td>
              </tr>
            </tfoot>
          </table>
        )}
        <p className="note">
          A loan EMI counts in full as spending, including the part that repays
          principal.
        </p>
      </section>

      <section aria-labelledby="history">
        <h3 id="history">Last six months</h3>
        <table>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">In</th>
              <th scope="col">Out</th>
              <th scope="col">Net</th>
            </tr>
          </thead>
          <tbody>
            {data.history.map((row) => (
              <tr key={monthParam(row.month)}>
                <th scope="row">
                  <a href={`/?month=${monthParam(row.month)}`}>
                    {monthLabel(row.month)}
                  </a>
                </th>
                <td>{formatInr(row.cashFlow.in)}</td>
                <td>{formatInr(row.cashFlow.out)}</td>
                <td>{formatInr(row.cashFlow.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="balances">
        <h3 id="balances">Balances today</h3>
        {data.balances.length === 0 && <p className="note">No accounts yet.</p>}
        {data.balances.map((group) => (
          <Amounts
            key={group.kind}
            title={KIND_LABELS[group.kind] ?? group.kind}
            rows={group.accounts}
            total={group.total}
          />
        ))}
        {data.balances.some((group) => group.kind === 'LOAN') && (
          <p className="note">
            Loan balances do not go down when you pay an EMI, so they may be out
            of date.
          </p>
        )}
      </section>

      <section aria-labelledby="people">
        <h3 id="people">People today</h3>
        {data.people.owesMe.length === 0 && data.people.iOwe.length === 0 && (
          <p className="note">Nobody owes anything.</p>
        )}
        {data.people.owesMe.length > 0 && (
          <Amounts
            title="Owes me"
            rows={data.people.owesMe}
            total={data.people.owesMeTotal}
          />
        )}
        {data.people.iOwe.length > 0 && (
          <Amounts
            title="I owe"
            rows={data.people.iOwe}
            total={data.people.iOweTotal}
          />
        )}
      </section>
    </main>
  );
}
