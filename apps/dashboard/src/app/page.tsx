import {
  ArrowDownLeft,
  ArrowUpRight,
  HandCoins,
  Landmark,
  Scale,
  TrendingUp,
} from 'lucide-react';

import { Note, Panel, Progress, StatCard, StatRow } from '../components/cards';
import { FlowChart, SavingsGauge } from '../components/charts';
import { Shell } from '../components/shell';
import { inr, signedInr } from '../lib/format';
import { monthLabel, withMonth } from '../lib/month';
import { loadPage, type PageProps } from '../lib/page';

export const dynamic = 'force-dynamic';

const TOP_CATEGORIES = 5;

function headline(
  income: bigint,
  out: bigint,
  net: bigint,
  month: string,
): string {
  if (income === 0n && out === 0n) return `No income or spending in ${month}.`;
  if (net >= 0n)
    return `You kept ${inr(net)} of the ${inr(income)} that came in.`;
  return `You spent ${inr(-net)} more than came in.`;
}

export default async function Overview(props: PageProps) {
  const { month, isCurrent, data } = await loadPage(props);
  const shell = {
    path: '/',
    title: 'Overview',
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

  const { cashFlow: flow } = data;
  const banks =
    data.balances.find((group) => group.kind === 'BANK')?.total ?? 0n;
  const largest = data.spend[0]?.total ?? 0n;

  return (
    <Shell {...shell} failed={false}>
      <div className="flex flex-col gap-4">
        <StatRow>
          <StatCard
            label="Money in"
            value={inr(flow.in)}
            icon={ArrowDownLeft}
          />
          <StatCard
            label="Money out"
            value={inr(flow.out)}
            icon={ArrowUpRight}
          />
          <StatCard label="Net" value={signedInr(flow.net)} icon={Scale} />
          <StatCard
            label="Invested"
            value={inr(data.invested)}
            icon={TrendingUp}
          />
          <StatCard
            label="In the bank today"
            value={inr(banks)}
            icon={Landmark}
          />
        </StatRow>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.5fr_1fr_1fr]">
          <section className="hero rise rise-2 min-h-56 p-6">
            <span aria-hidden="true" className="hero-glyph">
              ₹
            </span>
            <div className="relative max-w-[70%] sm:max-w-[60%]">
              <p className="text-sm text-[#d5e0ff]">{monthLabel(month)}</p>
              <p className="mt-1 text-4xl font-extrabold tabular-nums">
                {signedInr(flow.net)}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-[#d5e0ff]">
                {headline(flow.in, flow.out, flow.net, monthLabel(month))}
              </p>
              {flow.adjustments !== 0n && (
                <p className="mt-3 text-xs text-[#d5e0ff]">
                  Reconcile corrections, not in net:{' '}
                  <span className="whitespace-nowrap">
                    {signedInr(flow.adjustments)}
                  </span>
                </p>
              )}
            </div>
          </section>

          <Panel title="Savings rate" subtitle={monthLabel(month)}>
            <SavingsGauge rate={data.savingsRate} />
            {data.spend.some((row) => row.category === 'Home loan EMI') && (
              <Note>
                Counts an EMI in full, so real saving is a little higher.
              </Note>
            )}
          </Panel>

          <Panel title="People" subtitle="As of today">
            <a
              href={withMonth('/people', month)}
              className="flex flex-col gap-3 rounded-xl focus-visible:outline-2 focus-visible:outline-accent"
            >
              <span className="block rounded-xl bg-inset/70 p-4">
                <span className="flex items-center gap-2 text-xs text-soft">
                  <HandCoins aria-hidden="true" size={14} />
                  Owed to me
                </span>
                <span className="mt-1 block text-lg font-bold tabular-nums">
                  {inr(data.people.owesMeTotal)}
                </span>
              </span>
              <span className="block rounded-xl bg-inset/70 p-4">
                <span className="flex items-center gap-2 text-xs text-soft">
                  <HandCoins aria-hidden="true" size={14} />I owe
                </span>
                <span className="mt-1 block text-lg font-bold tabular-nums">
                  {inr(data.people.iOweTotal)}
                </span>
              </span>
            </a>
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.8fr_1fr]">
          <Panel title="Six months" subtitle="Money in and out">
            <FlowChart history={data.history} />
          </Panel>

          <Panel title="Top spending" subtitle={monthLabel(month)}>
            {data.spend.length === 0 ? (
              <p className="text-sm text-soft">No spending this month.</p>
            ) : (
              <ul className="flex flex-col gap-4">
                {data.spend.slice(0, TOP_CATEGORIES).map((row) => (
                  <li key={row.category}>
                    <div className="mb-1.5 flex justify-between gap-3 text-sm">
                      <span>{row.category}</span>
                      <span className="font-semibold tabular-nums">
                        {inr(row.total)}
                      </span>
                    </div>
                    <Progress value={row.total} max={largest} />
                  </li>
                ))}
              </ul>
            )}
            {data.spend.length > 0 && (
              <Note>
                <a
                  href={withMonth('/spending', month)}
                  className="underline underline-offset-2 hover:text-ink"
                >
                  See all spending
                </a>
              </Note>
            )}
          </Panel>
        </div>
      </div>
    </Shell>
  );
}
