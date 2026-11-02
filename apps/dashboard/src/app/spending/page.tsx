import { UNCATEGORISED } from '@hisaab/core';
import {
  Car,
  CircleHelp,
  Clapperboard,
  HeartPulse,
  House,
  Landmark,
  Plane,
  ReceiptText,
  Repeat,
  ShoppingBag,
  ShoppingBasket,
  Trophy,
  Utensils,
  Wallet,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import {
  headCell,
  Note,
  Panel,
  Progress,
  rowCell,
  StatCard,
  StatRow,
} from '../../components/cards';
import { OutBars } from '../../components/charts';
import { Shell } from '../../components/shell';
import { inr, percent, signedInr } from '../../lib/format';
import { monthLabel, withMonth } from '../../lib/month';
import { loadPage, type PageProps } from '../../lib/page';

export const dynamic = 'force-dynamic';

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Food: Utensils,
  Groceries: ShoppingBasket,
  Transport: Car,
  Rent: House,
  Utilities: Zap,
  Shopping: ShoppingBag,
  Entertainment: Clapperboard,
  Health: HeartPulse,
  Travel: Plane,
  Subscriptions: Repeat,
  'Home loan EMI': Landmark,
  Salary: Wallet,
  'Other income': Wallet,
  [UNCATEGORISED]: CircleHelp,
};

const shareOf = (part: bigint, whole: bigint): number =>
  whole === 0n ? 0 : Number((part * 1000n) / whole);

export default async function Spending(props: PageProps) {
  const { month, isCurrent, data } = await loadPage(props);
  const shell = {
    path: '/spending',
    title: 'Spending',
    month,
    isCurrent,
    showMonth: true,
  };
  if (!data)
    return (
      <Shell {...shell} failed>
        {null}
      </Shell>
    );

  const total = data.cashFlow.out;
  const top = data.spend[0];
  const hasEmi = data.spend.some((row) => row.category === 'Home loan EMI');

  return (
    <Shell {...shell} failed={false}>
      <div className="flex flex-col gap-4">
        <StatRow>
          <StatCard label="Total spent" value={inr(total)} icon={ReceiptText} />
          <StatCard
            label="Largest category"
            value={top ? top.category : 'None yet'}
            icon={Trophy}
          />
        </StatRow>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.8fr_1fr]">
          <Panel title="By category" subtitle={monthLabel(month)}>
            {!top ? (
              <p className="text-sm text-soft">No spending this month.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th scope="col" className={`${headCell} text-left`}>
                      Category
                    </th>
                    <th
                      scope="col"
                      className={`${headCell} hidden w-2/5 text-left sm:table-cell`}
                    >
                      Share
                    </th>
                    <th scope="col" className={`${headCell} text-right`}>
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.spend.map((row) => {
                    const Icon = CATEGORY_ICONS[row.category] ?? CircleHelp;
                    const share = percent(shareOf(row.total, total));
                    return (
                      <tr key={row.category}>
                        <th
                          scope="row"
                          className={`${rowCell} text-left font-medium`}
                        >
                          <span className="flex items-center gap-3">
                            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/5 text-[#7fa6ff]">
                              <Icon aria-hidden="true" size={16} />
                            </span>
                            {row.category}
                          </span>
                        </th>
                        <td className={`${rowCell} hidden pr-6 sm:table-cell`}>
                          <span className="mb-1 block text-xs font-semibold tabular-nums">
                            {share}
                          </span>
                          <Progress value={row.total} max={total} />
                        </td>
                        <td
                          className={`${rowCell} text-right font-semibold tabular-nums`}
                        >
                          {inr(row.total)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th
                      scope="row"
                      className={`${rowCell} text-left font-bold`}
                    >
                      Total
                    </th>
                    <td className={`${rowCell} hidden sm:table-cell`} />
                    <td
                      className={`${rowCell} text-right font-bold tabular-nums`}
                    >
                      {inr(total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
            {hasEmi && (
              <Note>
                A loan EMI counts in full as spending, including the part that
                repays principal.
              </Note>
            )}
          </Panel>

          <Panel title="Spending by month" subtitle="Select a month to open it">
            <OutBars path="/spending" history={data.history} selected={month} />
          </Panel>
        </div>

        <Panel title="Last six months">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th scope="col" className={`${headCell} text-left`}>
                    Month
                  </th>
                  <th scope="col" className={`${headCell} text-right`}>
                    In
                  </th>
                  <th scope="col" className={`${headCell} text-right`}>
                    Out
                  </th>
                  <th scope="col" className={`${headCell} text-right`}>
                    Net
                  </th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {data.history.map(({ month: m, cashFlow: flow }) => {
                  const empty = flow.in === 0n && flow.out === 0n;
                  return (
                    <tr
                      key={withMonth('', m)}
                      className={empty ? 'text-soft' : ''}
                    >
                      <th
                        scope="row"
                        className={`${rowCell} pr-3 text-left font-medium`}
                      >
                        <a
                          href={withMonth('/spending', m)}
                          className="underline-offset-2 hover:underline"
                        >
                          {monthLabel(m)}
                        </a>
                      </th>
                      <td className={`${rowCell} text-right`}>
                        {empty ? '—' : inr(flow.in)}
                      </td>
                      <td className={`${rowCell} text-right`}>
                        {empty ? '—' : inr(flow.out)}
                      </td>
                      <td className={`${rowCell} text-right font-semibold`}>
                        {empty ? '—' : signedInr(flow.net)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </Shell>
  );
}
