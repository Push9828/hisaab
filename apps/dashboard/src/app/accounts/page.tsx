import { type AccountKind } from '@hisaab/core';
import { CreditCard, Landmark, PiggyBank, type LucideIcon } from 'lucide-react';

import {
  AmountTable,
  Note,
  Panel,
  StatCard,
  StatRow,
} from '../../components/cards';
import { Shell } from '../../components/shell';
import { inr } from '../../lib/format';
import { loadPage, type PageProps } from '../../lib/page';

export const dynamic = 'force-dynamic';

const KINDS: Partial<
  Record<AccountKind, { title: string; stat: string; icon: LucideIcon }>
> = {
  BANK: { title: 'Bank accounts', stat: 'In the bank', icon: Landmark },
  CREDIT_CARD: {
    title: 'Credit cards',
    stat: 'Owed on cards',
    icon: CreditCard,
  },
  LOAN: { title: 'Loans', stat: 'Owed on loans', icon: PiggyBank },
};

export default async function Accounts(props: PageProps) {
  const { month, isCurrent, data } = await loadPage(props);
  const shell = {
    path: '/accounts',
    title: 'Accounts',
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

  const cards = data.balances.find((group) => group.kind === 'CREDIT_CARD');

  return (
    <Shell {...shell} failed={false}>
      <div className="flex flex-col gap-4">
        {data.balances.length === 0 ? (
          <p className="glass p-6 text-soft">
            No accounts yet. Create one with the bot, for example &quot;open
            icici 50k bank&quot;.
          </p>
        ) : (
          <StatRow>
            {data.balances.flatMap((group) => {
              const kind = KINDS[group.kind];
              return kind
                ? [
                    <StatCard
                      key={group.kind}
                      label={kind.stat}
                      value={inr(group.total)}
                      icon={kind.icon}
                    />,
                  ]
                : [];
            })}
          </StatRow>
        )}

        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-4">
            {data.balances.map((group) => {
              const kind = KINDS[group.kind];
              return (
                kind &&
                group.kind !== 'CREDIT_CARD' && (
                  <Panel key={group.kind} title={kind.title}>
                    <AmountTable
                      label="Account"
                      rows={group.accounts}
                      total={group.total}
                      icon={kind.icon}
                    />
                    {group.kind === 'LOAN' && (
                      <Note>
                        Loan balances do not go down when you pay an EMI, so
                        they may be out of date.
                      </Note>
                    )}
                  </Panel>
                )
              );
            })}
          </div>

          {cards && (
            <section aria-label="Credit cards" className="flex flex-col gap-4">
              {cards.accounts.map((card) => (
                <div key={card.name} className="money-card rise rise-2 p-6">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-bold">{card.name}</p>
                    <span aria-hidden="true" className="flex">
                      <span className="size-6 rounded-full bg-white/70" />
                      <span className="-ml-2.5 size-6 rounded-full bg-white/35" />
                    </span>
                  </div>
                  <p className="mt-10 text-xs text-[#d5e0ff]">Owed</p>
                  <p className="mt-1 text-3xl font-extrabold tabular-nums">
                    {inr(card.amount)}
                  </p>
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </Shell>
  );
}
