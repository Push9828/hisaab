import { type CashFlow, type Month } from '@hisaab/core';

import { barPercent, barTop } from '../lib/bar';
import { areaPath, gaugeDash, linePath, niceMax } from '../lib/charts';
import { inr, percent } from '../lib/format';
import { monthLabel, monthParam, withMonth } from '../lib/month';

const SIZE = { width: 600, height: 200 };
const shortMonth = (m: Month) => monthLabel(m).slice(0, 3);

function Legend() {
  return (
    <ul className="flex gap-4 text-xs text-soft">
      <li className="flex items-center gap-1.5">
        <svg aria-hidden="true" width="18" height="4">
          <line
            x1="0"
            y1="2"
            x2="18"
            y2="2"
            strokeWidth="2.5"
            className="stroke-in"
          />
        </svg>
        In
      </li>
      <li className="flex items-center gap-1.5">
        <svg aria-hidden="true" width="18" height="4">
          <line
            x1="0"
            y1="2"
            x2="18"
            y2="2"
            strokeWidth="2.5"
            strokeDasharray="4 3"
            className="stroke-out"
          />
        </svg>
        Out
      </li>
    </ul>
  );
}

/** Oldest on the left. Each column has a native tooltip, which needs no script. */
export function FlowChart({
  history,
}: {
  history: readonly { month: Month; cashFlow: CashFlow }[];
}) {
  const months = [...history].reverse();
  const inValues = months.map((m) => m.cashFlow.in);
  const outValues = months.map((m) => m.cashFlow.out);
  const max = niceMax([...inValues, ...outValues]);
  const columnWidth = SIZE.width / months.length;

  return (
    <figure>
      <Legend />
      <div className="mt-3 flex gap-2">
        <div
          aria-hidden="true"
          className="flex h-48 flex-col justify-between text-right text-[0.6875rem] text-soft tabular-nums"
        >
          <span>{inr(max)}</span>
          <span>{inr(max / 2n)}</span>
          <span>₹0</span>
        </div>
        <div className="min-w-0 flex-1">
          <svg
            role="img"
            aria-label="Money in and out for the last six months. The figures are in the table on the Spending page."
            viewBox={`0 0 ${SIZE.width} ${SIZE.height}`}
            preserveAspectRatio="none"
            className="block h-48 w-full"
          >
            <defs>
              <linearGradient id="in-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#4a86e8" stopOpacity="0.45" />
                <stop offset="1" stopColor="#4a86e8" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0, 100, 200].map((y) => (
              <line
                key={y}
                x1="0"
                x2={SIZE.width}
                y1={y}
                y2={y}
                vectorEffect="non-scaling-stroke"
                className="stroke-rule"
              />
            ))}
            <path d={areaPath(inValues, max, SIZE)} fill="url(#in-fill)" />
            <path
              d={linePath(inValues, max, SIZE)}
              fill="none"
              strokeWidth="2.5"
              vectorEffect="non-scaling-stroke"
              className="stroke-in"
            />
            <path
              d={linePath(outValues, max, SIZE)}
              fill="none"
              strokeWidth="2.5"
              strokeDasharray="6 5"
              vectorEffect="non-scaling-stroke"
              className="stroke-out"
            />
            {months.map((m, i) => (
              <rect
                key={monthParam(m.month)}
                x={i * columnWidth}
                y="0"
                width={columnWidth}
                height={SIZE.height}
                fill="transparent"
                className="chart-column"
              >
                <title>
                  {`${monthLabel(m.month)}: in ${inr(m.cashFlow.in)}, out ${inr(m.cashFlow.out)}`}
                </title>
              </rect>
            ))}
          </svg>
          <div
            aria-hidden="true"
            className="mt-2 grid grid-cols-6 text-center text-[0.6875rem] text-soft"
          >
            {months.map((m) => (
              <span key={monthParam(m.month)}>{shortMonth(m.month)}</span>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}

/** Six pill bars of spending, oldest on the left, each linking to its month. */
export function OutBars({
  path,
  history,
  selected,
}: {
  path: string;
  history: readonly { month: Month; cashFlow: CashFlow }[];
  selected: Month;
}) {
  const months = [...history].reverse();
  const max = niceMax(months.map((m) => m.cashFlow.out));
  return (
    <div className="grid grid-cols-6 rounded-2xl bg-inset/70 px-1 pt-5 pb-3">
      {months.map((m) => {
        const isSelected = monthParam(m.month) === monthParam(selected);
        return (
          <a
            key={monthParam(m.month)}
            href={withMonth(path, m.month)}
            aria-current={isSelected ? 'date' : undefined}
            className="group flex min-w-0 flex-col items-center gap-2 rounded-lg focus-visible:outline-2 focus-visible:outline-accent"
          >
            <svg
              aria-hidden="true"
              width="12"
              height="130"
              className="overflow-visible"
            >
              <rect width="12" height="130" rx="6" className="fill-white/8" />
              <rect
                y={barTop(m.cashFlow.out, max)}
                width="12"
                height={barPercent(m.cashFlow.out, max)}
                rx="6"
                className={
                  isSelected
                    ? 'fill-white'
                    : 'fill-[#6f9dff] group-hover:fill-white'
                }
              />
              <title>{`${monthLabel(m.month)}: ${inr(m.cashFlow.out)}`}</title>
            </svg>
            <span
              className={`text-[0.6875rem] ${isSelected ? 'font-bold' : 'text-soft'}`}
            >
              {shortMonth(m.month)}
              <span className="sr-only">{`: ${inr(m.cashFlow.out)}`}</span>
            </span>
          </a>
        );
      })}
    </div>
  );
}

const ARC = 'M 20 100 A 80 80 0 0 1 180 100';

export function SavingsGauge({ rate }: { rate: number | null }) {
  return (
    <div className="flex flex-col items-center">
      <svg aria-hidden="true" viewBox="0 0 200 110" className="w-full max-w-60">
        <defs>
          <linearGradient id="gauge" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#3d7bff" />
            <stop offset="1" stopColor="#4fd8a8" />
          </linearGradient>
        </defs>
        <path
          d={ARC}
          fill="none"
          strokeWidth="13"
          strokeLinecap="round"
          className="stroke-white/10"
        />
        {rate !== null && rate > 0 && (
          <path
            d={ARC}
            fill="none"
            stroke="url(#gauge)"
            strokeWidth="13"
            strokeLinecap="round"
            pathLength="100"
            strokeDasharray={gaugeDash(rate)}
          />
        )}
      </svg>
      <div className="-mt-12 text-center">
        <p className="text-3xl font-extrabold tabular-nums">
          {rate === null ? '—' : percent(rate)}
        </p>
        <p className="mt-1 text-xs text-soft">
          {rate === null ? 'No income logged' : 'of income kept'}
        </p>
      </div>
    </div>
  );
}
