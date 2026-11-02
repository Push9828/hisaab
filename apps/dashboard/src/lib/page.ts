import 'server-only';

import { loadOrNull } from './data';
import { monthParam, selectedMonth } from './month';

export type PageProps = {
  searchParams: Promise<{ month?: string | string[] }>;
};

/** What every dashboard page starts with. Reads nothing unless requireOwner passes. */
export async function loadPage({ searchParams }: PageProps) {
  const now = new Date();
  const month = selectedMonth((await searchParams).month, now);
  return {
    month,
    isCurrent: monthParam(month) === monthParam(selectedMonth(undefined, now)),
    data: await loadOrNull(month),
  };
}
