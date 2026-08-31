import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { chartColor, cn, formatDelta } from '@/lib/utils';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:opacity-90 disabled:opacity-40',
  secondary:
    'bg-raised text-ink border border-line-strong hover:bg-sunken disabled:opacity-40',
  ghost: 'text-muted hover:text-ink hover:bg-sunken disabled:opacity-40',
  danger: 'bg-negative text-white hover:opacity-90 disabled:opacity-40',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', size = 'md', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-md font-medium transition-colors',
        'disabled:cursor-not-allowed select-none whitespace-nowrap',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    />
  );
});

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <section className={cn('surface-card shadow-card', className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex items-start justify-between gap-4 px-5 pt-4 pb-3', className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-subtle">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'positive' | 'negative' | 'muted';
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-sunken text-muted border-line',
    accent: 'bg-accent-soft text-accent border-transparent',
    positive: 'bg-transparent text-positive border-positive/30',
    negative: 'bg-transparent text-negative border-negative/30',
    muted: 'bg-transparent text-subtle border-line',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border px-1.5 py-0.5 text-2xs font-medium whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Bar({
  value,
  className,
  color,
}: {
  value: number;
  className?: string;
  color?: string;
}) {
  const width = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-sunken', className)}
      role="presentation"
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-500', !color && 'bg-accent')}
        style={{ width: `${width}%`, background: color }}
      />
    </div>
  );
}

/**
 * A change is a judgement, not a number: the tinted chip makes direction readable at a glance
 * while the arrow keeps it legible without relying on colour alone (G9).
 */
export function DeltaPill({
  changePct,
  className,
  suffix = 'vs previous',
}: {
  changePct: number | null;
  className?: string;
  suffix?: string;
}) {
  // Nothing to compare against is not a flat trend, and a chip claiming 0% would say it was.
  if (changePct === null) {
    return (
      <span
        className={cn('text-2xs text-subtle', className)}
        title="No activity in the previous period"
      >
        —
      </span>
    );
  }

  const Icon = changePct === 0 ? Minus : changePct > 0 ? ArrowUpRight : ArrowDownRight;
  const tone =
    changePct === 0
      ? 'bg-sunken text-subtle'
      : changePct > 0
        ? 'bg-positive/10 text-positive'
        : 'bg-negative/10 text-negative';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-2xs font-medium whitespace-nowrap',
        tone,
        className,
      )}
      title={`${formatDelta(changePct)} ${suffix}`}
    >
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      {formatDelta(changePct)}
    </span>
  );
}

/**
 * Hairlines come from a 1px grid gap over a ruled background rather than from `divide-*`,
 * which draws on DOM order and so puts a stray edge on the first cell of every wrapped row.
 */
export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Card className={cn('overflow-hidden p-0', className)}>
      <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4 xl:grid-cols-8">{children}</div>
    </Card>
  );
}

/** One cell of the secondary metric strip: dense, aligned, and never louder than a KPI card. */
export function Stat({
  label,
  value,
  sub,
  icon,
  title,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  title?: string;
}) {
  return (
    <div className="bg-raised px-4 py-3.5" title={title}>
      <p className="flex items-center gap-1.5 text-2xs font-medium tracking-wide text-subtle uppercase">
        {icon ? <span className="text-subtle/80">{icon}</span> : null}
        {label}
      </p>
      <p className="tabular mt-1.5 truncate text-base font-semibold text-ink">{value}</p>
      {sub ? <p className="mt-0.5 truncate text-2xs text-subtle">{sub}</p> : null}
    </div>
  );
}

/**
 * A proportional bar for a set that competes for one whole. Segments below a pixel or two
 * read as noise, so anything under 1.5% is folded into the neighbouring share.
 */
export function SegmentedMeter({
  segments,
  className,
}: {
  segments: Array<{ key: string; label: string; value: number }>;
  className?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (total <= 0) return null;

  return (
    <div className={cn('flex h-2 w-full gap-0.5 overflow-hidden rounded-full', className)}>
      {segments.map((segment, index) => {
        const pct = (segment.value / total) * 100;
        if (pct < 1.5) return null;
        return (
          <div
            key={segment.key}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${pct}%`, background: chartColor(index) }}
            title={`${segment.label} · ${Math.round(pct)}%`}
          />
        );
      })}
    </div>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('font-mono text-xs text-muted', className)}>{children}</span>;
}
