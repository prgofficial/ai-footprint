import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ChartFrame, ColumnChart } from '@/components/charts/primitives';
import { FilterBar } from '@/components/layout/filter-bar';
import { PageHeader } from '@/components/layout/page';
import { Card } from '@/components/ui/primitives';
import { EmptyState, ErrorState, SkeletonChart } from '@/components/ui/states';
import { useFilters } from '@/hooks/useFilters';
import { useInsights } from '@/lib/queries';
import {
  WEEKDAY_LABELS,
  cn,
  formatDate,
  formatDuration,
  formatExact,
  formatHour,
  formatNumber,
} from '@/lib/utils';
import type { Insight, InsightsResponse } from '@ai-footprint/shared';

/** A bare number means nothing without its unit; the API says which one applies. */
function evidenceValue(insight: Insight): string {
  const { value, unit } = insight.evidence;
  switch (unit) {
    case 'words':
      return `${Math.round(value)} words`;
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

/** Set as a document rather than a card grid: a numbered column, the first entry given room. */
function Observation({ insight, rank }: { insight: Insight; rank: number }) {
  const lead = rank === 0;

  const body = (
    <div className="flex gap-4 sm:gap-6">
      <span
        aria-hidden="true"
        className={cn(
          'tabular w-6 shrink-0 pt-0.5 text-right text-2xs font-medium',
          lead ? 'text-accent' : 'text-subtle',
        )}
      >
        {String(rank + 1).padStart(2, '0')}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <p
            className={cn(
              'min-w-0 font-medium text-balance text-ink',
              lead ? 'text-lg leading-snug sm:text-xl' : 'text-sm leading-snug',
            )}
          >
            {insight.headline}
          </p>
          <span
            className={cn(
              'tabular shrink-0 font-semibold tracking-tight text-ink',
              lead ? 'text-3xl leading-none' : 'text-base',
            )}
          >
            {evidenceValue(insight)}
          </span>
        </div>

        <p
          className={cn(
            'mt-1.5 max-w-2xl leading-relaxed text-muted',
            lead ? 'text-sm' : 'text-xs',
          )}
        >
          {insight.detail}
        </p>

        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-subtle">
          <span>from {insight.evidence.of}</span>
          {insight.evidence.comparedWith ? <span>· vs {insight.evidence.comparedWith}</span> : null}
          {insight.href ? (
            <span className="inline-flex items-center gap-1 font-medium text-accent">
              See it <ArrowRight className="size-3" aria-hidden="true" />
            </span>
          ) : null}
        </p>
      </div>
    </div>
  );

  return (
    <li
      className={cn(
        'border-t border-line py-5 first:border-t-0 first:pt-0',
        insight.href && 'transition-opacity hover:opacity-80',
      )}
    >
      {insight.href ? (
        <Link to={insight.href} className="block">
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}

/** When the work happened, the one question no other screen in the product answers. */
function Rhythm({ rhythm }: { rhythm: InsightsResponse['rhythm'] }) {
  const { peak } = rhythm;
  const total = rhythm.hours.reduce((sum, entry) => sum + entry.prompts, 0);
  if (total === 0) return null;

  // The peak is a three-hour window and can wrap past midnight, so membership is modular.
  const inPeak = (hour: number): boolean => {
    if (!peak) return true;
    for (let offset = 0; offset < 3; offset++) {
      if ((peak.fromHour + offset) % 24 === hour) return true;
    }
    return false;
  };

  const busiestDay = [...rhythm.weekdays].sort((a, b) => b.prompts - a.prompts)[0];

  return (
    <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <Card className="px-3 pt-4 pb-4">
        <header className="mb-1 px-2">
          <h2 className="text-sm font-semibold tracking-tight text-ink">Hour of the day</h2>
          <p className="mt-0.5 text-xs text-subtle">
            {peak
              ? `Busiest between ${formatHour(peak.fromHour)} and ${formatHour(peak.toHour)}, in your local time.`
              : 'In your local time.'}
          </p>
        </header>
        <ChartFrame
          label="Prompts by hour of day"
          height={168}
          table={{
            columns: ['Hour', 'Prompts'],
            rows: rhythm.hours.map((entry) => [formatHour(entry.hour), entry.prompts]),
          }}
        >
          <ColumnChart
            name="Prompts"
            dim={(index) => !inPeak(rhythm.hours[index]?.hour ?? index)}
            data={rhythm.hours.map((entry) => ({
              label: entry.hour % 3 === 0 ? formatHour(entry.hour) : '',
              value: entry.prompts,
            }))}
          />
        </ChartFrame>
      </Card>

      <Card className="px-3 pt-4 pb-4">
        <header className="mb-1 px-2">
          <h2 className="text-sm font-semibold tracking-tight text-ink">Day of the week</h2>
          <p className="mt-0.5 text-xs text-subtle">
            {busiestDay && busiestDay.prompts > 0
              ? `${WEEKDAY_LABELS[busiestDay.weekday]} carries the most.`
              : 'Across the selected range.'}
          </p>
        </header>
        <ChartFrame
          label="Prompts by day of week"
          height={168}
          table={{
            columns: ['Day', 'Prompts'],
            rows: rhythm.weekdays.map((entry) => [
              WEEKDAY_LABELS[entry.weekday] ?? '',
              entry.prompts,
            ]),
          }}
        >
          <ColumnChart
            name="Prompts"
            dim={(index) => rhythm.weekdays[index]?.weekday !== busiestDay?.weekday}
            data={rhythm.weekdays.map((entry) => ({
              label: WEEKDAY_LABELS[entry.weekday] ?? '',
              value: entry.prompts,
            }))}
          />
        </ChartFrame>
      </Card>
    </section>
  );
}

function basisLine(basis: InsightsResponse['basis']): string {
  const corpus = [
    `Read from ${formatExact(basis.prompts)} prompt${basis.prompts === 1 ? '' : 's'}`,
    basis.sessions > 0
      ? ` across ${formatExact(basis.sessions)} session${basis.sessions === 1 ? '' : 's'}`
      : '',
  ].join('');
  return basis.recordedSince
    ? `${corpus}, recorded since ${formatDate(basis.recordedSince)}.`
    : `${corpus}.`;
}

export function InsightsPage() {
  const [filters] = useFilters();
  const query = useInsights(filters);
  const data = query.data;
  const insights = data?.insights ?? [];

  return (
    <>
      <PageHeader
        title="Insights"
        description="What your usage adds up to. Every claim carries the sample it came from, and anything too thin to be true is withheld."
      />
      <FilterBar dimensions={['provider', 'project']} />

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.isLoading || !data ? (
        <div className="space-y-4">
          <SkeletonChart className="h-32 w-full" />
          <SkeletonChart className="h-64 w-full" />
        </div>
      ) : (
        <div className="space-y-8">
          {/* The conclusion, in words, before any figure supports it. */}
          {data.summary ? (
            <section className="max-w-3xl">
              <p className="text-2xs font-medium tracking-[0.12em] text-subtle uppercase">
                The read
              </p>
              <p className="mt-3 text-xl leading-snug font-medium text-balance text-ink sm:text-2xl">
                {data.summary}
              </p>
              <p className="mt-4 border-t border-line pt-3 text-xs text-subtle">
                {basisLine(data.basis)}
              </p>
            </section>
          ) : null}

          {insights.length === 0 ? (
            <Card>
              <EmptyState
                title="Not enough data for an honest observation"
                description={
                  data.reason ??
                  'AI Footprint will not invent a pattern from a handful of prompts. Keep working and come back, or widen the time range.'
                }
              />
            </Card>
          ) : (
            <section>
              <h2 className="mb-4 max-w-5xl text-2xs font-medium tracking-[0.12em] text-subtle uppercase">
                {formatExact(insights.length)} observation{insights.length === 1 ? '' : 's'}
              </h2>
              {/* A measure of text, not a container to fill: at 1440px the evidence figure had
                  drifted a third of a screen from the sentence it belonged to. */}
              <ol className="max-w-5xl">
                {insights.map((insight, index) => (
                  <Observation key={insight.id} insight={insight} rank={index} />
                ))}
              </ol>
              {data.suppressed > 0 ? (
                <p className="mt-5 max-w-5xl border-t border-line pt-3 text-2xs text-subtle">
                  {data.suppressed} further observation{data.suppressed === 1 ? '' : 's'} met the
                  threshold to be computed but not the one to be stated, and{' '}
                  {data.suppressed === 1 ? 'was' : 'were'} withheld.
                </p>
              ) : null}
            </section>
          )}

          <Rhythm rhythm={data.rhythm} />
        </div>
      )}
    </>
  );
}
