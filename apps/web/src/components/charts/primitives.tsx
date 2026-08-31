import { useId, useMemo, useState, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
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
  labelFormatter,
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
  labelFormatter?: (label: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-raised px-3 py-2 shadow-pop">
      {label !== undefined ? (
        <p className="mb-1.5 text-2xs font-medium text-subtle">
          {labelFormatter ? labelFormatter(String(label)) : String(label)}
        </p>
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
  controls,
}: {
  children: ReactNode;
  table: { columns: string[]; rows: Array<Array<string | number>> };
  height?: number;
  label: string;
  className?: string;
  /** Chart-level controls, shown on the same row as the table toggle. */
  controls?: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-2">
        <div className="min-w-0">{controls}</div>
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
  axisFormatter,
  tickFormatter,
  labelFormatter,
  allowDecimals = false,
  ...size
}: {
  data: SeriesPoint[];
  name: string;
  formatter?: (value: number | string) => string;
  /** Value-axis ticks are cramped; they get a shorter label than the tooltip does. */
  axisFormatter?: (value: number) => string;
  tickFormatter?: (label: string) => string;
  labelFormatter?: (label: string) => string;
  allowDecimals?: boolean;
} & Sized) {
  const animate = !prefersReducedMotion();
  return (
    <AreaChart {...size} data={data} margin={{ top: 10, right: 10, bottom: 0, left: -14 }}>
      <defs>
        <linearGradient id="area-accent" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity={0.28} />
          <stop offset="55%" stopColor="rgb(var(--accent))" stopOpacity={0.08} />
          <stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity={0} />
        </linearGradient>
      </defs>
      <CartesianGrid stroke="rgb(var(--border))" strokeDasharray="2 4" vertical={false} />
      <XAxis dataKey="label" {...AXIS} minTickGap={28} tickFormatter={tickFormatter} />
      <YAxis
        {...AXIS}
        width={52}
        allowDecimals={allowDecimals}
        tickFormatter={(value: number) =>
          axisFormatter ? axisFormatter(value) : formatter ? formatter(value) : String(value)
        }
      />
      <Tooltip
        cursor={{ stroke: 'rgb(var(--accent))', strokeWidth: 1, strokeDasharray: '3 3' }}
        content={
          <ChartTooltip
            formatter={(value) => (formatter ? formatter(value) : String(value))}
            labelFormatter={labelFormatter}
          />
        }
      />
      <Area
        type="monotone"
        dataKey="value"
        name={name}
        stroke="rgb(var(--accent))"
        strokeWidth={2}
        fill="url(#area-accent)"
        isAnimationActive={animate}
        dot={false}
        activeDot={{ r: 3.5, strokeWidth: 2, stroke: 'rgb(var(--surface-raised))' }}
      />
    </AreaChart>
  );
}

/**
 * A metric card carries its own shape of the range. Recharts is far too much machinery for a
 * 32px trace that has no axes, no tooltip and no interaction, so this draws the path directly.
 */
export function Sparkline({
  values,
  className,
  color = 'rgb(var(--accent))',
}: {
  values: number[];
  className?: string;
  color?: string;
}) {
  const gradientId = useId();
  const width = 100;
  const height = 32;

  const path = useMemo(() => {
    if (values.length === 0) return null;
    const points = values.length === 1 ? [values[0]!, values[0]!] : values;
    const max = Math.max(...points);
    const min = Math.min(...points);
    const span = max - min || 1;
    const step = width / (points.length - 1);
    // A flat series sits on the baseline rather than halfway up, where it would read as data.
    const y = (value: number) =>
      max === min ? height - 3 : height - 3 - ((value - min) / span) * (height - 6);
    const line = points.map((value, index) => `${index * step},${y(value)}`).join(' L ');
    return { line: `M ${line}`, area: `M ${line} L ${width},${height} L 0,${height} Z` };
  }, [values]);

  if (!path) return null;

  return (
    <svg
      className={className}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={path.area} fill={`url(#${gradientId})`} />
      <path
        d={path.line}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
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
