import { ArrowRight, Lightbulb } from 'lucide-react';
import { Link } from 'react-router-dom';
import { FilterBar } from '@/components/layout/filter-bar';
import { PageHeader } from '@/components/layout/page';
import { Bar, Card, Stat, StatGrid } from '@/components/ui/primitives';
import { EmptyState, ErrorState, SkeletonChart, SkeletonRows } from '@/components/ui/states';
import { useFilters } from '@/hooks/useFilters';
import { useInsights } from '@/lib/queries';
import { chartColor, cn, formatDuration, formatExact, formatNumber } from '@/lib/utils';
import type { Insight } from '@ai-footprint/shared';

/** A bare number means nothing without its unit; the API says which one applies. */
function evidenceValue(insight: Insight): string {
  const { value, unit } = insight.evidence;
  switch (unit) {
    case 'percent':
      return `${Math.round(value)}%`;
    case 'points':
      return `${Math.round(value)} pts`;
    case 'duration':
      return formatDuration(value);
    case 'tokens':
      return formatNumber(value);
    default:
      return formatExact(Math.round(value));
  }
}

/**
 * The one observation most worth reading, given the room to say it. Seven identical cards, each
 * restating something Overview already ranks with a bar, taught a reader nothing, so the page
 * now has a focal point, and the accent is spent here and nowhere else.
 */
function LeadInsight({ insight, rank }: { insight: Insight; rank: number }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent ring-1 ring-accent/25">
          <Lightbulb className="size-4" aria-hidden="true" />
        </span>
        <span className="tabular text-3xl leading-none font-semibold tracking-tight text-ink">
          {evidenceValue(insight)}
        </span>
      </div>
      <p className="mt-4 text-base leading-relaxed font-medium text-ink">{insight.headline}</p>
      <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted">{insight.detail}</p>
      <div className="mt-4 border-t border-line pt-3">
        <p className="flex flex-wrap items-center gap-x-2 text-2xs text-subtle">
          <span>from {insight.evidence.of}</span>
          {insight.evidence.comparedWith ? <span>· vs {insight.evidence.comparedWith}</span> : null}
          {insight.href ? (
            <span className="ml-auto inline-flex items-center gap-1 font-medium text-accent">
              See it <ArrowRight className="size-3" aria-hidden="true" />
            </span>
          ) : null}
        </p>
        <Bar value={100} color={chartColor(rank)} className="mt-2.5" />
      </div>
    </>
  );

  return (
    <Card
      className={cn('fade-in p-5 transition-colors', insight.href && 'hover:border-line-strong')}
    >
      {insight.href ? (
        <Link to={insight.href} className="block">
          {body}
        </Link>
      ) : (
        body
      )}
    </Card>
  );
}

function SecondaryInsight({ insight, rank }: { insight: Insight; rank: number }) {
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm leading-relaxed font-medium text-ink">{insight.headline}</p>
        <span className="tabular shrink-0 text-lg font-semibold tracking-tight text-ink">
          {evidenceValue(insight)}
        </span>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted">{insight.detail}</p>
      <p className="mt-3 flex items-center gap-2 border-t border-line pt-2.5 text-2xs text-subtle">
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={{ background: chartColor(rank) }}
          aria-hidden="true"
        />
        from {insight.evidence.of}
      </p>
    </>
  );

  return (
    <Card
      className={cn('fade-in p-5 transition-colors', insight.href && 'hover:border-line-strong')}
    >
      {insight.href ? (
        <Link to={insight.href} className="block">
          {body}
        </Link>
      ) : (
        body
      )}
    </Card>
  );
}

export function InsightsPage() {
  const [filters] = useFilters();
  const query = useInsights(filters);
  const data = query.data;

  const insights = data?.insights ?? [];
  const [lead, ...rest] = insights;
  const secondary = rest.slice(0, 4);
  const remainder = rest.slice(4);

  return (
    <>
      <PageHeader
        title="Insights"
        description="What changed, and what the numbers behind it are. Nothing is stated without its sample."
      />
      <FilterBar dimensions={['provider', 'project']} />

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.isLoading || !data ? (
        <div className="space-y-4">
          <SkeletonChart className="h-52 w-full" />
          <SkeletonRows rows={4} />
        </div>
      ) : insights.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Lightbulb className="size-4" aria-hidden="true" />}
            title="Not enough data for an honest observation"
            description={
              data.reason ??
              'AI Footprint will not invent a pattern from a handful of prompts. Keep working and come back, or widen the time range.'
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {lead ? <LeadInsight insight={lead} rank={0} /> : null}

          {secondary.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {secondary.map((insight, index) => (
                <SecondaryInsight key={insight.id} insight={insight} rank={index + 1} />
              ))}
            </div>
          ) : null}

          {/* Everything below the fold is true but not news, so it gets one line each. */}
          {remainder.length > 0 ? (
            <StatGrid>
              {remainder.map((insight) => (
                <Stat
                  key={insight.id}
                  label={insight.kind.replace(/_/g, ' ')}
                  value={evidenceValue(insight)}
                  sub={insight.headline}
                  title={insight.detail}
                />
              ))}
            </StatGrid>
          ) : null}

          {data.suppressed > 0 ? (
            <p className="text-2xs text-subtle">
              {data.suppressed} further observation{data.suppressed === 1 ? '' : 's'} met the
              threshold to be computed but not the one to be stated, and{' '}
              {data.suppressed === 1 ? 'was' : 'were'} withheld.
            </p>
          ) : null}
        </div>
      )}
    </>
  );
}
