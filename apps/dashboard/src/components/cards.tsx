import { type NamedAmount } from '@hisaab/core';

import { barPercent } from '../lib/bar';
import { inr } from '../lib/format';

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
}) {
  return (
    <div className="glass rise flex items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="text-xs font-medium text-soft">{label}</p>
        <p className="mt-1 text-lg font-bold tabular-nums [overflow-wrap:anywhere] lg:text-xl">
          {value}
        </p>
      </div>
      <span className="icon-tile grid size-11 shrink-0 place-items-center rounded-xl text-white">
        <Icon aria-hidden="true" size={20} />
      </span>
    </div>
  );
}

export function StatRow({ children }: { children: ReactNode }) {
  return (
    <section
      aria-label="Summary"
      className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-4"
    >
      {children}
    </section>
  );
}

export function Panel({
  title,
  subtitle,
  className = '',
  children,
}: {
  title: string;
  subtitle?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`glass rise rise-2 min-w-0 p-5 ${className}`}>
      <h2 className="font-bold">{title}</h2>
      {subtitle && <p className="mt-0.5 text-sm text-soft">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-sm text-soft">{children}</p>;
}

/** An attribute, not a style: the CSP blocks inline styles. */
export function Progress({ value, max }: { value: bigint; max: bigint }) {
  return (
    <svg
      aria-hidden="true"
      width="100%"
      height="6"
      className="block overflow-hidden rounded-full bg-white/10"
    >
      <rect
        width={barPercent(value, max)}
        height="6"
        rx="3"
        className="fill-[#6f9dff]"
      />
    </svg>
  );
}

export const headCell =
  'pb-2 text-[0.6875rem] font-semibold tracking-wider text-soft uppercase';
export const rowCell = 'border-t border-rule py-3';

export function AmountTable({
  label,
  rows,
  total,
  icon: Icon,
}: {
  label: string;
  rows: readonly NamedAmount[];
  total: bigint;
  icon: LucideIcon;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr>
          <th scope="col" className={`${headCell} text-left`}>
            {label}
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
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/5 text-[#7fa6ff]">
                  <Icon aria-hidden="true" size={16} />
                </span>
                {row.name}
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
