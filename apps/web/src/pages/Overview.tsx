import {
  ArrowRight,
  Boxes,
  Clock3,
  Fingerprint,
  Layers,
  Plug,
  Repeat2,
  Wrench,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FilterBar } from '@/components/layout/filter-bar';
import { PageHeader } from '@/components/layout/page';
import { AreaTrend, ChartFrame } from '@/components/charts/primitives';
import {
  Badge,
  Bar,
  Card,
  CardHeader,
  DeltaPill,
  Kpi,
  SegmentedMeter,
  Stat,
  StatGrid,
} from '@/components/ui/primitives';
import { EmptyState, ErrorState, SkeletonChart, SkeletonMetrics } from '@/components/ui/states';
import { useFilters } from '@/hooks/useFilters';
import { useOverview } from '@/lib/queries';
import {
  chartColor,
  cn,
  formatBucket,
  formatCompact,
  formatCost,
  formatDate,
  formatDuration,
  formatExact,
  formatNumber,
  formatPercent,
  type Granularity,
} from '@/lib/utils';
import type { OverviewResponse, TimeseriesPoint } from '@ai-footprint/shared';

function CostKpi({
  period,
  plan,
  series,
}: {
  period: OverviewResponse['period'];
  plan: OverviewResponse['plan'];
  series: number[];
}) {
  const api = period.estimatedCostUsd.value;
  const subscription = plan?.billing === 'subscription' ? plan : null;
  const paid = subscription?.periodUsd ?? null;
  const leverage = api !== null && paid !== null && paid > 0 ? api / paid : null;

  if (!subscription) {
    return (
      <Kpi
        label="Estimated cost"
        value={formatCost(api)}
        delta={period.estimatedCostUsd.changePct === null ? undefined : period.estimatedCostUsd}
        hint="Estimated from token counts and published list prices."
        sub="at list API prices"
        series={series}
      />
    );
  }

  return (
    <Kpi
      label="API-equivalent"
      value={formatCost(api)}
      hint={`What this usage would have cost at published API prices. You are on ${subscription.name ?? 'a subscription'}, so it is not a bill — your actual cost for this period is ${formatCost(paid)}.`}
      sub={
        <span className="flex items-center gap-1.5">
          <span>you paid {formatCost(paid)}</span>
          {leverage !== null ? (
            <Badge tone="positive" className="px-1.5 py-0">
              {leverage >= 10 ? Math.round(leverage) : leverage.toFixed(1)}× value
            </Badge>
          ) : null}
        </span>
      }
      series={series}
    />
  );
}

/** Three ranked cards side by side only read as a set if they are the same height. */
const TOP_N = 8;

interface RankRow {
  key: string;
  name: string;
  value: number;
  share: number;
}

/**
 * Bars are scaled against the leader rather than against 100%, because a top-N list is read
 * for its order and relative weight. The percentage beside each row keeps the absolute truth.
 */
function RankedList({
  rows,
  emptyLabel,
  linkTo,
}: {
  rows: RankRow[];
  emptyLabel: string;
  linkTo?: (key: string) => string;
}) {
  if (rows.length === 0) {
    return <p className="px-5 pb-5 text-xs text-subtle">{emptyLabel}</p>;
  }
  const leader = Math.max(...rows.map((row) => row.share), 0.0001);

  return (
    <ul className="space-y-3 px-5 pb-5">
      {rows.map((row, index) => (
        <li key={row.key}>
          <div className="mb-1.5 flex items-center gap-2">
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: chartColor(index) }}
              aria-hidden="true"
            />
            {linkTo ? (
              <Link
                to={linkTo(row.key)}
                className="truncate text-xs text-ink transition-colors hover:text-accent"
              >
                {row.name}
              </Link>
            ) : (
              <span className="truncate text-xs text-ink">{row.name}</span>
            )}
            <span className="tabular ml-auto shrink-0 text-xs font-medium text-ink">
              {formatNumber(row.value)}
            </span>
            <span className="tabular w-11 shrink-0 text-right text-2xs text-subtle">
              {formatPercent(row.share, row.share < 10 ? 1 : 0)}
            </span>
          </div>
          <Bar
            value={(row.share / leader) * 100}
            color={chartColor(index)}
            className={index === 0 ? '' : 'opacity-75'}
          />
        </li>
      ))}
    </ul>
  );
}

interface TimelineMetric {
  key: string;
  label: string;
  read: (point: TimeseriesPoint) => number;
  format: (value: number) => string;
  axis: (value: number) => string;
  decimals: boolean;
}

const PROMPTS_METRIC: TimelineMetric = {
  key: 'prompts',
  label: 'Prompts',
  read: (point) => point.prompts,
  format: (value) => formatExact(value),
  axis: (value) => formatCompact(value),
  decimals: false,
};

function timelineMetrics(data: OverviewResponse): TimelineMetric[] {
  const metrics: TimelineMetric[] = [PROMPTS_METRIC];

  // Active time is only summed per day; at hour and week granularity it comes back as zero,
  // and an axis of zeroes is worse than not offering the choice.
  if (data.granularity === 'day') {
    metrics.push({
      key: 'active',
      label: 'Active time',
      read: (point) => point.activeMs,
      format: (value) => formatDuration(value),
      axis: (value) => formatDuration(value),
      decimals: false,
    });
  }
  if (data.period.tokens.value > 0) {
    metrics.push({
      key: 'tokens',
      label: 'Tokens',
      read: (point) => point.inputTokens + point.outputTokens,
      format: (value) => formatExact(value),
      axis: (value) => formatCompact(value),
      decimals: false,
    });
  }
  if (data.period.estimatedCostUsd.value !== null) {
    metrics.push({
      key: 'cost',
      label: 'Cost',
      read: (point) => point.estimatedCostUsd ?? 0,
      format: (value) => formatCost(value),
      axis: (value) => formatCost(value),
      decimals: true,
    });
  }
  return metrics;
}

function Timeline({ data }: { data: OverviewResponse }) {
  const [selected, setSelected] = useState('prompts');
  const metrics = useMemo(() => timelineMetrics(data), [data]);
  // The chosen metric can disappear when the range changes granularity; fall back rather
  // than render an empty chart.
  const metric = metrics.find((entry) => entry.key === selected) ?? PROMPTS_METRIC;
  const granularity = data.granularity as Granularity;

  return (
    <Card>
      <CardHeader
        title="Activity timeline"
        description={`${formatExact(data.totals.prompts)} prompts across ${formatExact(data.totals.sessions)} sessions`}
      />
      <div className="px-3 pb-4">
        <ChartFrame
          label={`${metric.label} over time`}
          height={260}
          controls={
            metrics.length > 1 ? (
              <div
                className="inline-flex rounded-md border border-line bg-sunken p-0.5"
                role="group"
                aria-label="Timeline metric"
              >
                {metrics.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    aria-pressed={metric.key === entry.key}
                    onClick={() => setSelected(entry.key)}
                    className={cn(
                      'rounded px-2.5 py-1 text-2xs font-medium whitespace-nowrap transition-colors',
                      metric.key === entry.key
                        ? 'bg-raised text-ink shadow-card'
                        : 'text-subtle hover:text-ink',
                    )}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            ) : null
          }
          table={{
            columns: ['Date', 'Prompts', 'Sessions', 'Active time', 'Tokens', 'Cost'],
            rows: data.timeline.map((point) => [
              formatBucket(point.bucket, granularity, 'full'),
              point.prompts,
              point.sessions,
              formatDuration(point.activeMs),
              formatExact(point.inputTokens + point.outputTokens),
              formatCost(point.estimatedCostUsd),
            ]),
          }}
        >
          <AreaTrend
            name={metric.label}
            allowDecimals={metric.decimals}
            formatter={(value) => metric.format(Number(value))}
            axisFormatter={(value) => metric.axis(value)}
            tickFormatter={(label) => formatBucket(label, granularity, 'tick')}
            labelFormatter={(label) => formatBucket(label, granularity, 'full')}
            data={data.timeline.map((point) => ({
              label: point.bucket,
              value: metric.read(point),
            }))}
          />
        </ChartFrame>
      </div>
    </Card>
  );
}

function cacheReuse(period: OverviewResponse['period']): number | null {
  const inbound = period.inputTokens + period.cacheReadTokens + period.cacheWriteTokens;
  if (inbound <= 0) return null;
  return (period.cacheReadTokens / inbound) * 100;
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
            <span className="rounded-full border border-line bg-raised px-2.5 py-1 text-2xs text-subtle">
              {formatDate(data.range.from)} – {formatDate(data.range.to)} · {data.range.timezone}
            </span>
          ) : null
        }
      />
      <FilterBar dimensions={['provider', 'project', 'category', 'model']} />

      {query.isLoading || !data ? (
        <div className="space-y-4">
          <SkeletonMetrics />
          <SkeletonChart className="h-20 w-full" />
          <SkeletonChart className="h-72 w-full" />
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
        <PeriodDashboard data={data} range={filters.range} />
      )}
    </>
  );
}

function PeriodDashboard({ data, range }: { data: OverviewResponse; range: string }) {
  const { period, timeline } = data;
  const reuse = cacheReuse(period);
  const busiest = period.busiestBucket;
  const granularity = data.granularity as Granularity;

  const technologyTotal = data.technologies.reduce((sum, row) => sum + row.prompts, 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Prompts"
          value={formatExact(period.prompts.value)}
          delta={period.prompts}
          sub={`${formatExact(period.prompts.previous)} in the period before`}
          series={timeline.map((point) => point.prompts)}
        />
        <Kpi
          label="Active time"
          value={formatDuration(period.activeMs.value)}
          delta={period.activeMs}
          sub="idle gaps excluded"
          series={timeline.map((point) => (granularity === 'day' ? point.activeMs : point.prompts))}
        />
        <Kpi
          label="Tokens"
          // Every billable token, not just input and output. Cache reads are the great majority
          // of the cost here, and showing 168M beside a cost built from 41 billion left the two
          // tiles impossible to reconcile.
          value={formatNumber(period.billableTokens.value)}
          delta={period.billableTokens}
          hint={`${formatExact(period.inputTokens)} in · ${formatExact(period.outputTokens)} out · ${formatExact(period.cacheReadTokens)} cache read · ${formatExact(period.cacheWriteTokens)} cache write`}
          sub={`${formatNumber(period.cacheReadTokens)} of it re-read from cache`}
          series={timeline.map((point) => point.inputTokens + point.outputTokens)}
        />
        <CostKpi
          period={period}
          plan={data.plan}
          series={timeline
            .filter((point) => point.estimatedCostUsd !== null)
            .map((point) => point.estimatedCostUsd ?? 0)}
        />
      </div>

      <StatGrid>
        <Stat
          label="Sessions"
          icon={<Layers className="size-3" aria-hidden="true" />}
          value={formatExact(period.sessions.value)}
          sub={<DeltaPill changePct={period.sessions.changePct} />}
        />
        <Stat
          label="Tool calls"
          icon={<Wrench className="size-3" aria-hidden="true" />}
          value={formatNumber(period.toolCalls.value)}
          sub={<DeltaPill changePct={period.toolCalls.changePct} />}
          title="Edits, searches and commands the assistant ran on your behalf."
        />
        <Stat
          label="Projects"
          icon={<Boxes className="size-3" aria-hidden="true" />}
          value={formatExact(period.projects)}
          sub="with activity"
        />
        <Stat
          label="Sources"
          icon={<Plug className="size-3" aria-hidden="true" />}
          value={
            data.sources.length === 1 ? data.sources[0]!.name : formatExact(data.sources.length)
          }
          // "the only tool used" was asserted even when a source filter was narrowing the page
          // to one, and "connected tools" was claimed for sources that are merely present.
          sub={data.sources.length === 1 ? 'in this selection' : 'tools in this selection'}
          title={data.sources.map((source) => source.name).join(', ')}
        />
        <Stat
          label="Per session"
          icon={<Repeat2 className="size-3" aria-hidden="true" />}
          value={
            period.promptsPerSession >= 10
              ? formatExact(Math.round(period.promptsPerSession))
              : period.promptsPerSession.toFixed(1)
          }
          sub="prompts on average"
        />
        <Stat
          label="Session length"
          icon={<Clock3 className="size-3" aria-hidden="true" />}
          value={formatDuration(period.msPerSession)}
          sub="active time, average"
        />
        <Stat
          label="Cache reuse"
          icon={<Fingerprint className="size-3" aria-hidden="true" />}
          value={reuse === null ? '—' : formatPercent(reuse)}
          sub="of context re-read"
          title="Share of incoming tokens served from the prompt cache rather than sent afresh."
        />
        <Stat
          label="Busiest"
          value={busiest ? formatBucket(busiest.bucket, granularity, 'tick') : '—'}
          sub={busiest ? `${formatExact(busiest.prompts)} prompts` : 'no activity'}
        />
      </StatGrid>

      <Timeline data={data} />

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader
            title="Top areas"
            description="What you brought to AI"
            action={
              data.categories.length > TOP_N ? (
                <Link
                  to={`/prompts/analytics?range=${range}`}
                  className="text-2xs text-subtle transition-colors hover:text-accent"
                >
                  All {data.categories.length}
                </Link>
              ) : null
            }
          />
          <RankedList
            rows={data.categories.slice(0, TOP_N).map((row) => ({
              key: row.category,
              name: row.category,
              value: row.prompts,
              share: row.share,
            }))}
            emptyLabel="Nothing classified yet."
            linkTo={(key) => `/prompts?range=${range}&category=${encodeURIComponent(key)}`}
          />
        </Card>

        <Card>
          <CardHeader title="Top projects" description="Where the work happened" />
          <RankedList
            rows={data.projects.map((row) => ({
              key: row.projectId,
              name: row.name,
              value: row.prompts,
              share: row.share,
            }))}
            emptyLabel="No projects detected yet."
            linkTo={(key) => `/prompts?range=${range}&projectId=${encodeURIComponent(key)}`}
          />
        </Card>

        <Card>
          <CardHeader title="Models" description="Which model did the answering" />
          <RankedList
            rows={data.models.slice(0, TOP_N).map((row) => ({
              key: row.model,
              name: row.model,
              value: row.responses,
              share: row.share,
            }))}
            emptyLabel="No model recorded yet."
            linkTo={(key) => `/activity?range=${range}&model=${encodeURIComponent(key)}`}
          />
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Top technologies"
          description="What you talked about most"
          action={
            data.technologies.length > 0 ? (
              <span className="text-2xs text-subtle">{formatExact(technologyTotal)} mentions</span>
            ) : null
          }
        />
        <div className="px-5 pb-5">
          {data.technologies.length === 0 ? (
            <p className="text-xs text-subtle">No technologies detected yet.</p>
          ) : (
            <>
              <SegmentedMeter
                segments={data.technologies.map((row) => ({
                  key: row.technology,
                  label: row.technology,
                  value: row.prompts,
                }))}
              />
              <div className="mt-3.5 flex flex-wrap gap-1.5">
                {data.technologies.map((row, index) => (
                  <Link
                    key={row.technology}
                    to={`/prompts?range=${range}&technology=${encodeURIComponent(row.technology)}`}
                  >
                    <Badge
                      tone="neutral"
                      className="gap-1.5 py-1 transition-colors hover:border-line-strong hover:text-ink"
                    >
                      <span
                        className="size-1.5 rounded-full"
                        style={{ background: chartColor(index) }}
                        aria-hidden="true"
                      />
                      {row.technology}
                      <span className="tabular text-subtle">{formatNumber(row.prompts)}</span>
                    </Badge>
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
