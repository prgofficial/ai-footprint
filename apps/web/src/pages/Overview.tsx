import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { FilterBar } from '@/components/layout/filter-bar';
import { PageHeader, Section } from '@/components/layout/page';
import { AreaTrend, ChartFrame, DonutChart } from '@/components/charts/primitives';
import { Bar, Badge, Card, CardHeader } from '@/components/ui/primitives';
import { EmptyState, ErrorState, SkeletonChart, SkeletonMetrics } from '@/components/ui/states';
import { useFilters } from '@/hooks/useFilters';
import { useOverview } from '@/lib/queries';
import {
  chartColor,
  cn,
  formatCost,
  formatDate,
  formatDelta,
  formatDuration,
  formatExact,
  formatNumber,
  formatPercent,
} from '@/lib/utils';
import type { MetricDelta } from '@ai-footprint/shared';

function Metric({
  label,
  value,
  sub,
  delta,
  hint,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: MetricDelta;
  hint?: string;
}) {
  const change = delta?.changePct ?? null;
  const Icon = change === null || change === 0 ? Minus : change > 0 ? ArrowUpRight : ArrowDownRight;
  const tone =
    change === null || change === 0
      ? 'text-subtle'
      : change > 0
        ? 'text-positive'
        : 'text-negative';

  return (
    <Card className="p-5">
      <p className="text-2xs font-medium tracking-wide text-subtle uppercase">{label}</p>
      <p className="tabular mt-2 text-2xl font-semibold tracking-tight text-ink" title={hint}>
        {value}
      </p>
      <div className="mt-2 flex items-center gap-1.5 text-xs">
        {delta ? (
          <>
            <Icon className={cn('size-3', tone)} aria-hidden="true" />
            <span className={tone}>{formatDelta(change)}</span>
            <span className="text-subtle">vs previous period</span>
          </>
        ) : (
          <span className="text-subtle">{sub}</span>
        )}
      </div>
    </Card>
  );
}

function RankedList({
  rows,
  emptyLabel,
  linkTo,
}: {
  rows: Array<{ key: string; name: string; prompts: number; share: number }>;
  emptyLabel: string;
  linkTo?: (key: string) => string;
}) {
  if (rows.length === 0) {
    return <p className="px-5 pb-5 text-xs text-subtle">{emptyLabel}</p>;
  }
  return (
    <ul className="space-y-2.5 px-5 pb-5">
      {rows.map((row, index) => (
        <li key={row.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            {linkTo ? (
              <Link to={linkTo(row.key)} className="truncate text-xs text-ink hover:text-accent">
                {row.name}
              </Link>
            ) : (
              <span className="truncate text-xs text-ink">{row.name}</span>
            )}
            <span className="tabular shrink-0 text-xs text-subtle">
              {formatPercent(row.share, row.share < 10 ? 1 : 0)}
            </span>
          </div>
          <Bar value={row.share} className={index === 0 ? '' : 'opacity-70'} />
        </li>
      ))}
    </ul>
  );
}

export function OverviewPage() {
  const [filters] = useFilters();
  const query = useOverview(filters);

  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const data = query.data;
  const hasData = (data?.totals.events ?? 0) > 0;

  return (
    <>
      <PageHeader
        title="Overview"
        description="How much you are using AI, and what for."
        actions={
          data ? (
            <span className="text-2xs text-subtle">
              {formatDate(data.range.from)} – {formatDate(data.range.to)} · {data.range.timezone}
            </span>
          ) : null
        }
      />
      <FilterBar dimensions={['provider', 'project', 'category', 'model']} />

      {query.isLoading || !data ? (
        <div className="space-y-6">
          <SkeletonMetrics />
          <SkeletonChart className="h-64 w-full" />
        </div>
      ) : !hasData ? (
        <Card>
          <EmptyState
            title="No AI activity yet"
            description="Connect an AI tool and carry on working normally. Your AI Footprint will appear here."
            action={
              <Link
                to="/connections"
                className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-3.5 text-sm font-medium text-white"
              >
                Connect a tool <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          <Section title="Today">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric
                label="Prompts"
                value={formatExact(data.today.prompts)}
                sub="submitted today"
              />
              <Metric
                label="Sessions"
                value={formatExact(data.today.sessions)}
                sub="started today"
              />
              <Metric
                label="Active time"
                value={formatDuration(data.today.activeMs)}
                sub="idle gaps excluded"
              />
              <Metric
                label="Tokens"
                value={formatNumber(data.today.inputTokens + data.today.outputTokens)}
                sub={`${formatNumber(data.today.inputTokens)} in · ${formatNumber(data.today.outputTokens)} out`}
                hint={`${formatExact(data.today.inputTokens)} in, ${formatExact(data.today.outputTokens)} out`}
              />
            </div>
          </Section>

          <Section title="This period">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric
                label="Prompts"
                value={formatExact(data.period.prompts.value)}
                delta={data.period.prompts}
              />
              <Metric
                label="Sessions"
                value={formatExact(data.period.sessions.value)}
                delta={data.period.sessions}
              />
              <Metric
                label="Active time"
                value={formatDuration(data.period.activeMs.value)}
                delta={data.period.activeMs}
              />
              <Metric
                label="Estimated cost"
                value={formatCost(data.period.estimatedCostUsd)}
                sub="at list API prices"
                hint="Estimated from token counts and published list prices. It does not reflect a subscription."
              />
            </div>
          </Section>

          <Card>
            <CardHeader
              title="Activity timeline"
              description={`${formatExact(data.totals.prompts)} prompts across ${formatExact(data.totals.sessions)} sessions`}
            />
            <div className="px-3 pb-4">
              <ChartFrame
                label="Prompts over time"
                height={240}
                table={{
                  columns: ['Date', 'Prompts', 'Active time'],
                  rows: data.timeline.map((point) => [
                    point.bucket,
                    point.prompts,
                    formatDuration(point.activeMs),
                  ]),
                }}
              >
                <AreaTrend
                  name="Prompts"
                  data={data.timeline.map((point) => ({
                    label: point.bucket,
                    value: point.prompts,
                  }))}
                />
              </ChartFrame>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader title="Sources" description="Which tools the activity came from" />
              {data.sources.length > 1 ? (
                <div className="px-3 pb-2">
                  <ChartFrame
                    label="Prompts by source"
                    height={180}
                    table={{
                      columns: ['Source', 'Prompts'],
                      rows: data.sources.map((s) => [s.name, s.prompts]),
                    }}
                  >
                    <DonutChart
                      data={data.sources.map((s) => ({ label: s.name, value: s.prompts }))}
                    />
                  </ChartFrame>
                </div>
              ) : null}
              <RankedList
                rows={data.sources.map((s) => ({
                  key: s.providerId,
                  name: s.name,
                  prompts: s.prompts,
                  share: s.share,
                }))}
                emptyLabel="No sources yet."
              />
            </Card>

            <Card>
              <CardHeader title="Top areas" description="What you brought to AI" />
              <RankedList
                rows={data.categories.map((c) => ({
                  key: c.category,
                  name: c.category,
                  prompts: c.prompts,
                  share: c.share,
                }))}
                emptyLabel="Nothing classified yet."
                linkTo={(key) =>
                  `/prompts?range=${filters.range}&category=${encodeURIComponent(key)}`
                }
              />
            </Card>

            <Card>
              <CardHeader title="Top projects" description="Where the work happened" />
              <RankedList
                rows={data.projects.map((p) => ({
                  key: p.projectId,
                  name: p.name,
                  prompts: p.prompts,
                  share: p.share,
                }))}
                emptyLabel="No projects detected yet."
                linkTo={(key) =>
                  `/prompts?range=${filters.range}&projectId=${encodeURIComponent(key)}`
                }
              />
            </Card>
          </div>

          <Card>
            <CardHeader title="Top technologies" description="What you talked about most" />
            <div className="flex flex-wrap gap-1.5 px-5 pb-5">
              {data.technologies.length === 0 ? (
                <p className="text-xs text-subtle">No technologies detected yet.</p>
              ) : (
                data.technologies.map((technology, index) => (
                  <Link
                    key={technology.technology}
                    to={`/prompts?range=${filters.range}&technology=${encodeURIComponent(technology.technology)}`}
                  >
                    <Badge tone={index === 0 ? 'accent' : 'neutral'} className="gap-1.5">
                      <span
                        className="size-1.5 rounded-full"
                        style={{ background: chartColor(index) }}
                        aria-hidden="true"
                      />
                      {technology.technology}
                      <span className="tabular text-subtle">{technology.prompts}</span>
                    </Badge>
                  </Link>
                ))
              )}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
