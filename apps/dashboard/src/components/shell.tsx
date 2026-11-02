import { type Month } from '@hisaab/core';
import {
  ChevronLeft,
  ChevronRight,
  Landmark,
  LayoutDashboard,
  LogOut,
  ReceiptText,
  Users,
} from 'lucide-react';

import { signOut } from '../app/actions';
import { monthLabel, shiftMonth, withMonth } from '../lib/month';

import type { ReactNode } from 'react';

const PAGES = [
  { path: '/', label: 'Overview', icon: LayoutDashboard },
  { path: '/spending', label: 'Spending', icon: ReceiptText },
  { path: '/accounts', label: 'Accounts', icon: Landmark },
  { path: '/people', label: 'People', icon: Users },
];

function Sidebar({ path, month }: { path: string; month: Month }) {
  return (
    <aside className="glass flex shrink-0 flex-col gap-3 p-3 lg:sticky lg:top-4 lg:h-[calc(100dvh-2rem)] lg:w-60 lg:p-4">
      <div className="flex items-center justify-between lg:block">
        <p className="px-2 text-sm font-semibold tracking-[0.3em] lg:border-b lg:border-rule lg:py-4 lg:text-center">
          HISAAB
        </p>
        <form action={signOut} className="lg:hidden">
          <SignOut />
        </form>
      </div>
      <nav
        aria-label="Pages"
        className="grid grid-cols-4 gap-1 lg:flex lg:flex-col lg:pt-2"
      >
        {PAGES.map(({ path: to, label, icon: Icon }) => {
          const active = to === path;
          return (
            <a
              key={to}
              href={withMonth(to, month)}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-col items-center gap-1 rounded-xl p-2 text-xs font-medium transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-accent lg:flex-row lg:gap-3 lg:p-2.5 lg:text-sm ${active ? 'nav-active' : 'text-soft'}`}
            >
              <span
                className={`grid size-8 place-items-center rounded-lg ${active ? 'icon-tile text-white' : 'bg-white/5 text-[#7fa6ff]'}`}
              >
                <Icon aria-hidden="true" size={16} />
              </span>
              {label}
            </a>
          );
        })}
      </nav>
      <form action={signOut} className="mt-auto hidden lg:block">
        <SignOut />
      </form>
    </aside>
  );
}

function SignOut() {
  return (
    <button
      type="submit"
      className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-rule px-3 py-2 text-xs font-medium text-soft transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-accent"
    >
      <LogOut aria-hidden="true" size={14} />
      Sign out everywhere
    </button>
  );
}

function MonthNav({
  path,
  month,
  isCurrent,
}: {
  path: string;
  month: Month;
  isCurrent: boolean;
}) {
  const button =
    'grid size-9 place-items-center rounded-xl border border-rule transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-accent';
  return (
    <nav aria-label="Month" className="flex items-center gap-2">
      <a
        href={withMonth(path, shiftMonth(month, -1))}
        aria-label="Previous month"
        className={button}
      >
        <ChevronLeft aria-hidden="true" size={16} />
      </a>
      <span className="min-w-32 text-center text-sm font-semibold">
        {monthLabel(month)}
      </span>
      {isCurrent ? (
        <span aria-hidden="true" className="size-9" />
      ) : (
        <a
          href={withMonth(path, shiftMonth(month, 1))}
          aria-label="Next month"
          className={button}
        >
          <ChevronRight aria-hidden="true" size={16} />
        </a>
      )}
    </nav>
  );
}

export function Shell({
  path,
  title,
  month,
  isCurrent,
  showMonth,
  failed,
  children,
}: {
  path: string;
  title: string;
  month: Month;
  isCurrent: boolean;
  showMonth: boolean;
  failed: boolean;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-[92rem] flex-col gap-4 p-3 lg:flex-row lg:gap-6 lg:p-4">
      <Sidebar path={path} month={month} />
      <main className="min-w-0 flex-1 py-2">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-bold">{title}</h1>
          {showMonth ? (
            <MonthNav path={path} month={month} isCurrent={isCurrent} />
          ) : (
            <p className="text-sm text-soft">As of today</p>
          )}
        </header>
        {failed ? (
          <p role="alert" className="glass p-6 text-soft">
            The dashboard could not load. Reload to try again.
          </p>
        ) : (
          children
        )}
      </main>
    </div>
  );
}
