import { type NamedAmount } from '@hisaab/core';
import { HandCoins, Handshake } from 'lucide-react';

import {
  headCell,
  Panel,
  rowCell,
  StatCard,
  StatRow,
} from '../../components/cards';
import { Shell } from '../../components/shell';
import { initials, inr } from '../../lib/format';
import { loadPage, type PageProps } from '../../lib/page';

export const dynamic = 'force-dynamic';

function PersonTable({
  rows,
  total,
  badge,
  badgeClass,
  empty,
}: {
  rows: readonly NamedAmount[];
  total: bigint;
  badge: string;
  badgeClass: string;
  empty: string;
}) {
  if (rows.length === 0) return <p className="text-sm text-soft">{empty}</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr>
          <th scope="col" className={`${headCell} text-left`}>
            Person
          </th>
          <th scope="col" className={`${headCell} text-right`}>
            Amount
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.name}>
            <th scope="row" className={`${rowCell} text-left font-medium`}>
              <span className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="icon-tile grid size-9 shrink-0 place-items-center rounded-xl text-xs font-bold text-white"
                >
                  {initials(row.name)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate">{row.name}</span>
                  <span
                    className={`mt-1 inline-block rounded-md border px-1.5 py-0.5 text-[0.6875rem] font-semibold ${badgeClass}`}
                  >
                    {badge}
                  </span>
                </span>
              </span>
            </th>
            <td className={`${rowCell} text-right font-semibold tabular-nums`}>
              {inr(row.amount)}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row" className={`${rowCell} text-left font-bold`}>
            Total
          </th>
          <td className={`${rowCell} text-right font-bold tabular-nums`}>
            {inr(total)}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

export default async function People(props: PageProps) {
  const { month, isCurrent, data } = await loadPage(props);
  const shell = {
    path: '/people',
    title: 'People',
    month,
    isCurrent,
    showMonth: false,
  };
  if (!data)
    return (
      <Shell {...shell} failed>
        {null}
      </Shell>
    );

  const { people } = data;

  return (
    <Shell {...shell} failed={false}>
      <div className="flex flex-col gap-4">
        <StatRow>
          <StatCard
            label="Owed to me"
            value={inr(people.owesMeTotal)}
            icon={HandCoins}
          />
          <StatCard
            label="I owe"
            value={inr(people.iOweTotal)}
            icon={Handshake}
          />
        </StatRow>
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          <Panel title="Owes me">
            <PersonTable
              rows={people.owesMe}
              total={people.owesMeTotal}
              badge="Owes me"
              badgeClass="border-good/40 text-good"
              empty="Nobody owes you anything."
            />
          </Panel>
          <Panel title="I owe">
            <PersonTable
              rows={people.iOwe}
              total={people.iOweTotal}
              badge="I owe"
              badgeClass="border-warn/40 text-warn"
              empty="You don't owe anyone."
            />
          </Panel>
        </div>
      </div>
    </Shell>
  );
}
