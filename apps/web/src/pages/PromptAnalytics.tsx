import { ColumnChart, ChartFrame } from '@/components/charts/primitives';
import { FilterBar } from '@/components/layout/filter-bar';
import { PageHeader, Section } from '@/components/layout/page';
import { Badge, Bar, Card, CardHeader } from '@/components/ui/primitives';
import { EmptyState, ErrorState, SkeletonChart, SkeletonMetrics } from '@/components/ui/states';
import { useFilters } from '@/hooks/useFilters';
import { usePromptAnalytics } from '@/lib/queries';
import { WEEKDAY_LABELS, formatDate, formatExact, formatHour, formatPercent } from '@/lib/utils';

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-5">
      <p className="text-2xs font-medium tracking-wide text-subtle uppercase">{label}</p>
      <p className="tabular mt-2 text-2xl font-semibold tracking-tight text-ink">{value}</p>
      {sub ? <p className="mt-1 text-xs text-subtle">{sub}</p> : null}
    </Card>
  );
}

export function PromptAnalyticsPage() {
  const [filters] = useFilters();
  const query = usePromptAnalytics(filters);
  const data = query.data;

  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  return (
    <>
      <PageHeader title="Prompt analytics" description="Patterns in how you ask." />
      <FilterBar dimensions={['provider', 'project', 'model']} />

      {query.isLoading || !data ? (
        <div className="space-y-6">
          <SkeletonMetrics />
          <SkeletonChart className="h-64" />
        </div>
      ) : data.categories.length === 0 ? (
        <Card>
          <EmptyState
            title="Not enough prompts to analyse"
            description="Once you have used AI for a while, this page shows the shape of how you ask."
          />
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Average length"
              value={`${formatExact(data.avgWordLength)} words`}
              sub={`${formatExact(data.avgCharLength)} characters`}
            />
            <Stat label="Prompts per session" value={String(data.promptsPerSession)} />
            <Stat
              label="Repeated prompts"
              value={formatExact(data.repeated.length)}
              sub="asked more than once"
            />
            <Stat
              label="Categories used"
              value={formatExact(data.categories.filter((c) => c.prompts > 0).length)}
              sub="of 13"
            />
          </div>

          <Section title="Categories" description="What you bring to AI, and how that shifted">
            <Card>
              <ul className="space-y-3 p-5">
                {data.categories.map((category) => {
                  const shift =
                    category.previousShare === null
                      ? null
                      : category.share - category.previousShare;
                  return (
                    <li key={category.category}>
                      <div className="mb-1 flex items-baseline justify-between gap-3">
                        <span className="text-xs text-ink">
                          {category.category === 'Other' ? 'Unclassified' : category.category}
                        </span>
                        <span className="flex items-baseline gap-2">
                          {shift !== null && Math.abs(shift) >= 1 ? (
                            <span
                              className={
                                shift > 0 ? 'text-2xs text-positive' : 'text-2xs text-negative'
                              }
                            >
                              {shift > 0 ? '+' : ''}
                              {shift.toFixed(0)} pts
                            </span>
                          ) : null}
                          <span className="tabular text-xs text-subtle">
                            {formatExact(category.prompts)} · {formatPercent(category.share)}
                          </span>
                        </span>
                      </div>
                      <Bar value={category.share} />
                    </li>
                  );
                })}
              </ul>
            </Card>
          </Section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Most active hours" description="In your local timezone" />
              <div className="px-3 pb-4">
                <ChartFrame
                  label="Prompts by hour of day"
                  height={200}
                  table={{
                    columns: ['Hour', 'Prompts'],
                    rows: data.activeHours.map((h) => [formatHour(h.hour), h.prompts]),
                  }}
                >
                  <ColumnChart
                    name="Prompts"
                    data={data.activeHours.map((h) => ({
                      label: h.hour % 3 === 0 ? formatHour(h.hour) : '',
                      value: h.prompts,
                    }))}
                  />
                </ChartFrame>
              </div>
            </Card>

            <Card>
              <CardHeader title="Most active days" />
              <div className="px-3 pb-4">
                <ChartFrame
                  label="Prompts by day of week"
                  height={200}
                  table={{
                    columns: ['Day', 'Prompts'],
                    rows: data.activeDays.map((d) => [WEEKDAY_LABELS[d.weekday] ?? '', d.prompts]),
                  }}
                >
                  <ColumnChart
                    name="Prompts"
                    data={data.activeDays.map((d) => ({
                      label: WEEKDAY_LABELS[d.weekday] ?? '',
                      value: d.prompts,
                    }))}
                  />
                </ChartFrame>
              </div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Common themes"
                description="Words that recur across your prompts"
              />
              <div className="flex flex-wrap gap-1.5 px-5 pb-5">
                {data.themes.length === 0 ? (
                  <p className="text-xs text-subtle">Not enough prompt text to find themes.</p>
                ) : (
                  data.themes.map((theme) => (
                    <Badge key={theme.term} className="gap-1.5">
                      {theme.term}
                      <span className="tabular text-subtle">{theme.count}</span>
                    </Badge>
                  ))
                )}
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Repeated prompts"
                description="Asked more than once, ignoring paths and numbers"
              />
              {data.repeated.length === 0 ? (
                <p className="px-5 pb-5 text-xs text-subtle">Nothing repeated in this period.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {data.repeated.map((entry) => (
                    <li key={entry.fingerprint} className="flex items-start gap-3 px-5 py-2.5">
                      <span className="tabular shrink-0 text-xs font-medium text-accent">
                        ×{entry.count}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-xs text-ink">
                          {entry.text || 'Prompt text not stored'}
                        </p>
                        <p className="mt-0.5 text-2xs text-subtle">
                          last {formatDate(entry.lastSeenAt)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Most active projects" />
              <ul className="divide-y divide-line">
                {data.topProjects.map((project) => (
                  <li
                    key={project.projectId}
                    className="flex items-center justify-between px-5 py-2.5"
                  >
                    <span className="truncate text-xs text-ink">{project.name}</span>
                    <span className="tabular text-xs text-subtle">
                      {formatExact(project.prompts)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card>
              <CardHeader title="Most discussed technologies" />
              <ul className="divide-y divide-line">
                {data.topTechnologies.map((technology) => (
                  <li
                    key={technology.technology}
                    className="flex items-center justify-between px-5 py-2.5"
                  >
                    <span className="truncate text-xs text-ink">{technology.technology}</span>
                    <span className="tabular text-xs text-subtle">
                      {formatExact(technology.prompts)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
