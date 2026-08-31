import { AlertTriangle, Inbox, WifiOff } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button, Card } from './primitives';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-4 w-full', className)} aria-hidden="true" />;
}

export function SkeletonMetrics({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} className="p-5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-7 w-24" />
          <Skeleton className="mt-3 h-3 w-16" />
        </Card>
      ))}
    </div>
  );
}

export function SkeletonRows({ rows = 8 }: { rows?: number }) {
  return (
    <div className="divide-y divide-line" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-3">
          <Skeleton className="h-3 w-16 shrink-0" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-20 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonChart({ className }: { className?: string }) {
  return <div className={cn('skeleton', className ?? 'h-56 w-full')} aria-busy="true" />;
}

/** Brief §38: zero data must still look considered, and must offer the next step. */
export function EmptyState({
  title,
  description,
  action,
  icon,
  compact,
}: {
  title: string;
  description: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'px-6 py-10' : 'px-6 py-20',
      )}
    >
      <div className="mb-4 flex size-10 items-center justify-center rounded-full border border-line bg-sunken text-subtle">
        {icon ?? <Inbox className="size-4" aria-hidden="true" />}
      </div>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-subtle">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** Brief §39: a person sees a sentence; the raw cause hides behind a disclosure. */
export function ErrorState({
  error,
  onRetry,
  compact,
}: {
  error: unknown;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const apiError = error instanceof ApiError ? error : null;
  const offline = apiError?.status === 0;

  const title = apiError?.title ?? 'Something went wrong';
  const message =
    apiError?.message ?? 'AI Footprint could not load this view. Try again in a moment.';
  const details = apiError?.details ?? (error instanceof Error ? error.message : String(error));

  return (
    <div
      className={cn('flex flex-col items-center justify-center px-6 text-center', compact ? 'py-10' : 'py-20')}
      role="alert"
    >
      <div className="mb-4 flex size-10 items-center justify-center rounded-full border border-line bg-sunken text-negative">
        {offline ? <WifiOff className="size-4" aria-hidden="true" /> : <AlertTriangle className="size-4" aria-hidden="true" />}
      </div>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-1.5 max-w-md text-xs leading-relaxed text-subtle">{message}</p>

      <div className="mt-5 flex items-center gap-2">
        {onRetry ? (
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
        {details ? (
          <Button size="sm" variant="ghost" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
            {open ? 'Hide technical details' : 'View technical details'}
          </Button>
        ) : null}
      </div>

      {open && details ? (
        <pre className="mt-4 max-w-xl overflow-x-auto rounded-md border border-line bg-sunken p-3 text-left font-mono text-2xs whitespace-pre-wrap text-muted">
          {details}
        </pre>
      ) : null}
    </div>
  );
}

export function InlineNote({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'warning' }) {
  return (
    <p
      className={cn(
        'rounded-md border px-3 py-2 text-xs',
        tone === 'warning'
          ? 'border-accent/30 bg-accent-soft text-accent'
          : 'border-line bg-sunken text-subtle',
      )}
    >
      {children}
    </p>
  );
}
