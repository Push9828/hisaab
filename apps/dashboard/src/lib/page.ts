import 'server-only';

import { loadOrNull } from './data';
import { isLatestMonth, selectedMonth } from './month';

export type PageProps = {
  searchParams: Promise<{ month?: string | string[] }>;
};

/** What every dashboard page starts with. Reads nothing unless requireOwner passes. */
export async function loadPage({ searchParams }: PageProps) {
  const now = new Date();
  const month = selectedMonth((await searchParams).month, now);
  return {
    month,
    isCurrent: isLatestMonth(month, now),
    data: await loadOrNull(month),
  };
}
