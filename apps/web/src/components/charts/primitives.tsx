import { useMemo, useState, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Table2 } from 'lucide-react';
import { chartColor, cn } from '@/lib/utils';
import { Button } from '../ui/primitives';

const AXIS = {
  stroke: 'rgb(var(--border-strong))',
  fontSize: 11,
  tick: { fill: 'rgb(var(--ink-subtle))' },
  tickLine: false,
  axisLine: false,
};

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function ChartTooltip({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: Array<{
    name?: string;
    value?: number | string;
    color?: string;
    payload?: Record<string, unknown>;
  }>;
  label?: string | number;
  formatter?: (value: number | string, name: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line bg-raised px-2.5 py-2 shadow-pop">
      {label !== undefined ? (
        <p className="mb-1 text-2xs font-medium text-subtle">{String(label)}</p>
      ) : null}
      {payload.map((entry, index) => (
        <p key={index} className="flex items-center gap-2 text-xs text-ink">
          <span
            className="size-2 shrink-0 rounded-[2px]"
            style={{ background: entry.color }}
            aria-hidden="true"
          />
          <span className="text-muted">{entry.name}</span>
          <span className="tabular ml-auto font-medium">
            {formatter && entry.value !== undefined
              ? formatter(entry.value, entry.name ?? '')
              : String(entry.value)}
          </span>
        </p>
      ))}
    </div>
  );
}

/**
 * G9: a chart that only exists as pixels is unusable with a screen reader, so every chart
 * carries the same numbers as a table one keystroke away.
 */
export function ChartFrame({
  children,
  table,
  height = 224,
  label,
  className,
}: {
  children: ReactNode;
  table: { columns: string[]; rows: Array<Array<string | number>> };
  height?: number;
  label: string;
  className?: string;
}) {
  const [showTable, setShowTable] = useState(false);

  return (
    <div className={className}>
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowTable((value) => !value)}
          aria-pressed={showTable}
        >
          <Table2 className="size-3" aria-hidden="true" />
          {showTable ? 'Show chart' : 'Show data'}
        </Button>
      </div>

      {showTable ? (
        <div className="overflow-x-auto" style={{ maxHeight: height + 24 }}>
          <table className="w-full text-xs">
            <caption className="sr-only">{label}</caption>
            <thead className="sticky top-0 bg-raised">
              <tr className="border-b border-line text-left text-subtle">
                {table.columns.map((column) => (
                  <th key={column} scope="col" className="px-2 py-1.5 font-medium">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, index) => (
                <tr key={index} className="border-b border-line/60 last:border-0">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className={cn('px-2 py-1.5', cellIndex > 0 && 'tabular')}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <figure role="img" aria-label={label} style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            {children as never}
          </ResponsiveContainer>
        </figure>
      )}
    </div>
  );
}

export interface SeriesPoint {
  label: string;
  value: number;
}

/**
 * ResponsiveContainer measures itself and clones its child with `width` and `height`.
 * A wrapper component has to forward those onto the Recharts chart, or the chart renders
 * with no dimensions and paints nothing.
 */
interface Sized {
  width?: number;
  height?: number;
}

export function AreaTrend({
  data,
  name,
  formatter,
  ...size
}: {
  data: SeriesPoint[];
  name: string;
  formatter?: (value: number | string) => string;
} & Sized) {
  const animate = !prefersReducedMotion();
  return (
    <AreaChart {...size} data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
      <defs>
        <linearGradient id="area-accent" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity={0.24} />
          <stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <XAxis dataKey="label" {...AXIS} minTickGap={28} />
      <YAxis {...AXIS} width={44} allowDecimals={false} />
      <Tooltip
        cursor={{ stroke: 'rgb(var(--border-strong))' }}
        content={
          <ChartTooltip formatter={(value) => (formatter ? formatter(value) : String(value))} />
        }
      />
      <Area
        type="monotone"
        dataKey="value"
        name={name}
        stroke="rgb(var(--accent))"
        strokeWidth={1.75}
        fill="url(#area-accent)"
        isAnimationActive={animate}
        dot={false}
        activeDot={{ r: 3, strokeWidth: 0 }}
      />
    </AreaChart>
  );
}

export function ColumnChart({
  data,
  name,
  formatter,
  ...size
}: {
  data: SeriesPoint[];
  name: string;
  formatter?: (value: number | string) => string;
} & Sized) {
  const animate = !prefersReducedMotion();
  return (
    <BarChart {...size} data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
      <XAxis dataKey="label" {...AXIS} minTickGap={16} />
      <YAxis {...AXIS} width={40} allowDecimals={false} />
      <Tooltip
        cursor={{ fill: 'rgb(var(--border) / 0.4)' }}
        content={
          <ChartTooltip formatter={(value) => (formatter ? formatter(value) : String(value))} />
        }
      />
      <Bar dataKey="value" name={name} radius={[2, 2, 0, 0]} isAnimationActive={animate}>
        {data.map((_, index) => (
          <Cell key={index} fill="rgb(var(--accent))" />
        ))}
      </Bar>
    </BarChart>
  );
}

export function DonutChart({
  data,
  ...size
}: { data: Array<{ label: string; value: number }> } & Sized) {
  const animate = !prefersReducedMotion();
  const total = useMemo(() => data.reduce((sum, entry) => sum + entry.value, 0), [data]);

  return (
    <PieChart {...size}>
      <Tooltip
        content={
          <ChartTooltip
            formatter={(value) =>
              `${value} (${total > 0 ? Math.round((Number(value) / total) * 100) : 0}%)`
            }
          />
        }
      />
      <Pie
        data={data}
        dataKey="value"
        nameKey="label"
        innerRadius="58%"
        outerRadius="88%"
        paddingAngle={1.5}
        strokeWidth={0}
        isAnimationActive={animate}
      >
        {data.map((_, index) => (
          <Cell key={index} fill={chartColor(index)} />
        ))}
      </Pie>
    </PieChart>
  );
}
