import { Link } from 'react-router-dom';
import { Boxes, Clock3, Layers, Plug } from 'lucide-react';
import { FilterBar } from '@/components/layout/filter-bar';
import { PageHeader } from '@/components/layout/page';
import { Bar, Card, CardHeader, Kpi, Stat, StatGrid } from '@/components/ui/primitives';
import { EmptyState, ErrorState, SkeletonMetrics, SkeletonRows } from '@/components/ui/states';
import { useFilters } from '@/hooks/useFilters';
import { useProfile } from '@/lib/queries';
import {
  chartColor,
  formatDate,
  formatDuration,
  formatExact,
  formatHour,
  formatNumber,
  formatPercent,
} from '@/lib/utils';
import type { ProfileResponse } from '@ai-footprint/shared';

/**
 * One sentence, assembled from the same figures shown beneath it. A portrait should state its
 * conclusion before it shows its working, the page previously opened with six enormous floating
 * percentages and left the reader to draw the conclusion themselves.
 */
function summary(data: ProfileResponse): string {
  const top = data.distribution.filter((entry) => entry.category !== 'Other').slice(0, 2);
  const areas =
    top.length === 0
      ? 'across a mix of work'
      : top.length === 1
        ? `mostly on ${top[0]!.category.toLowerCase()}`
        : `mostly on ${top[0]!.category.toLowerCase()} and ${top[1]!.category.toLowerCase()}`;

  const tool = data.mostUsedTool
    ? `${data.mostUsedTool.share >= 90 ? 'almost entirely in' : 'mainly in'} ${data.mostUsedTool.name}`
    : null;
  const project = data.mostActiveProject ? `mostly on ${data.mostActiveProject.name}` : null;
  const when = data.mostActivePeriod
    ? `and you work with it most between ${formatHour(data.mostActivePeriod.fromHour)} and ${formatHour(data.mostActivePeriod.toHour)}`
    : null;

  return [`You used AI ${areas}`, tool, project, when].filter(Boolean).join(', ') + '.';
}

export function ProfilePage() {
  const [filters] = useFilters();
  const query = useProfile(filters);
  // Tenure is a fact about the whole history, not about the tab you happen to have selected.
  // Reading it from the scoped response made "Recorded since" restate the range tab.
  const history = useProfile({ range: 'all' });
  const data = query.data;

  const leader = data ? Math.max(...data.distribution.map((entry) => entry.share), 0.0001) : 1;
  const promptsPerSession =
    data && data.totalSessions > 0 ? data.totalPrompts / data.totalSessions : 0;

  return (
    <>
      <PageHeader
        title="Your AI Footprint"
        description="How you work with AI, drawn only from what happened on this machine."
        actions={
          data ? (
            <span className="rounded-full border border-line bg-raised px-2.5 py-1 text-2xs text-subtle">
              {formatDate(data.range.from)} – {formatDate(data.range.to)}
            </span>
          ) : null
        }
      />
      <FilterBar dimensions={['provider']} />

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.isLoading || !data ? (
        <div className="space-y-4">
          <SkeletonMetrics />
          <Card>
            <SkeletonRows rows={6} />
          </Card>
        </div>
      ) : !data.hasEnoughData ? (
        <Card>
          <EmptyState
            title="Your footprint is still forming"
            description="A profile needs a handful of prompts before it says anything true. Keep using AI as you normally would."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {/* The conclusion, before the evidence. */}
          <Card className="px-5 py-5">
            <p className="max-w-3xl text-base leading-relaxed text-ink sm:text-lg">
              {summary(data)}
            </p>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              label="Top area"
              value={formatPercent(data.distribution[0]?.share ?? 0)}
              sub={
                data.distribution[0]?.category === 'Other'
                  ? 'unclassified'
                  : (data.distribution[0]?.category ?? '—')
              }
              hint={`${formatExact(data.distribution[0]?.prompts ?? 0)} prompts`}
              series={data.distribution.map((entry) => entry.share)}
            />
            <Kpi
              label="Tool concentration"
              value={formatPercent(data.mostUsedTool?.share ?? 0)}
              sub={data.mostUsedTool?.name ?? 'no source yet'}
              series={data.distribution.map((entry) => entry.share)}
            />
            <Kpi
              label="Project focus"
              value={
                data.mostActiveProject && data.totalPrompts > 0
                  ? formatPercent((data.mostActiveProject.prompts / data.totalPrompts) * 100)
                  : '—'
              }
              sub={data.mostActiveProject?.name ?? 'no project yet'}
              hint={`${formatExact(data.mostActiveProject?.prompts ?? 0)} of ${formatExact(data.totalPrompts)} prompts`}
              series={data.distribution.map((entry) => entry.prompts)}
            />
            <Kpi
              label="Peak window"
              value={
                data.mostActivePeriod
                  ? `${formatHour(data.mostActivePeriod.fromHour)}–${formatHour(data.mostActivePeriod.toHour)}`
                  : '—'
              }
              sub={
                data.mostActivePeriod && data.totalPrompts > 0
                  ? `${formatPercent((data.mostActivePeriod.prompts / data.totalPrompts) * 100)} of your prompts`
                  : 'not enough data'
              }
              series={data.distribution.map((entry) => entry.prompts)}
            />
          </div>

          <StatGrid>
            <Stat
              label="Prompts"
              icon={<Layers className="size-3" aria-hidden="true" />}
              value={formatExact(data.totalPrompts)}
              sub="in this period"
            />
            <Stat
              label="Sessions"
              icon={<Boxes className="size-3" aria-hidden="true" />}
              value={formatExact(data.totalSessions)}
              sub="conversations"
            />
            <Stat
              label="Per session"
              value={
                promptsPerSession >= 10
                  ? formatExact(Math.round(promptsPerSession))
                  : promptsPerSession.toFixed(1)
              }
              sub="prompts on average"
            />
            <Stat
              label="Session length"
              icon={<Clock3 className="size-3" aria-hidden="true" />}
              value={formatDuration(data.averageSessionMs)}
              sub="active time, average"
              title="Idle gaps are excluded, so this is time worked rather than time elapsed."
            />
            <Stat label="Areas" value={formatExact(data.distribution.length)} sub="kinds of work" />
            <Stat
              label="Source"
              icon={<Plug className="size-3" aria-hidden="true" />}
              value={data.mostUsedTool?.name ?? '—'}
              sub="most used"
            />
            <Stat label="Focus" value={data.mostActiveProject?.name ?? '—'} sub="busiest project" />
            <Stat
              label="History"
              value={history.data?.firstActivityAt ? formatDate(history.data.firstActivityAt) : '—'}
              sub="recorded since"
            />
          </StatGrid>

          <Card>
            <CardHeader
              title="What you bring to AI"
              description="Every prompt in this period, by the kind of work it was"
              action={
                <Link
                  to={`/prompts/analytics?range=${filters.range}`}
                  className="text-2xs text-subtle transition-colors hover:text-accent"
                >
                  Prompt analytics
                </Link>
              }
            />
            <ul className="space-y-3 px-5 pb-5">
              {data.distribution.map((entry, index) => (
                <li key={entry.category}>
                  <div className="mb-1.5 flex items-center gap-2">
                    <span
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ background: chartColor(index) }}
                      aria-hidden="true"
                    />
                    <Link
                      to={`/prompts?range=${filters.range}&category=${encodeURIComponent(entry.category)}`}
                      className="truncate text-xs text-ink transition-colors hover:text-accent"
                    >
                      {entry.category === 'Other' ? 'Unclassified' : entry.category}
                    </Link>
                    <span className="tabular ml-auto shrink-0 text-xs font-medium text-ink">
                      {formatNumber(entry.prompts)}
                    </span>
                    <span className="tabular w-11 shrink-0 text-right text-2xs text-subtle">
                      {formatPercent(entry.share, entry.share < 10 ? 1 : 0)}
                    </span>
                  </div>
                  <Bar
                    value={(entry.share / leader) * 100}
                    color={chartColor(index)}
                    className={index === 0 ? '' : 'opacity-75'}
                  />
                </li>
              ))}
            </ul>
            <p className="border-t border-line px-5 py-3 text-2xs text-subtle">
              Everything on this page was computed on this machine from your own activity.
            </p>
          </Card>
        </div>
      )}
    </>
  );
}
