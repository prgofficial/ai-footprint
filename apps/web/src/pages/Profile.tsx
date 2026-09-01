import { FilterBar } from '@/components/layout/filter-bar';
import { PageHeader } from '@/components/layout/page';
import { Card } from '@/components/ui/primitives';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/states';
import { useFilters } from '@/hooks/useFilters';
import { useProfile } from '@/lib/queries';
import {
  chartColor,
  formatDate,
  formatDuration,
  formatExact,
  formatHour,
  formatPercent,
} from '@/lib/utils';

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-line py-4">
      <dt className="text-2xs tracking-wide text-subtle uppercase">{label}</dt>
      <dd className="mt-1 text-lg font-medium tracking-tight text-ink">{value}</dd>
    </div>
  );
}

export function ProfilePage() {
  const [filters] = useFilters();
  const query = useProfile(filters);
  // Tenure is a fact about the whole history, not about the tab you happen to have selected.
  // Reading it from the scoped response made "Recorded since" restate the range tab.
  const history = useProfile({ range: 'all' });
  const data = query.data;

  return (
    <>
      <PageHeader title="Your AI Footprint" description="A summary of how you work with AI." />
      <FilterBar dimensions={['provider']} />

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.isLoading || !data ? (
        <Card>
          <SkeletonRows rows={6} />
        </Card>
      ) : !data.hasEnoughData ? (
        <Card>
          <EmptyState
            title="Your footprint is still forming"
            description="A profile needs a handful of prompts before it says anything true. Keep using AI as you normally would."
          />
        </Card>
      ) : (
        <div className="mx-auto max-w-3xl">
          <section className="mb-10">
            <ol className="space-y-5">
              {data.distribution.slice(0, 6).map((entry, index) => (
                <li key={entry.category} className="fade-in flex items-baseline gap-5">
                  <span
                    className="tabular w-24 shrink-0 text-right text-3xl font-semibold tracking-tighter"
                    style={{ color: chartColor(index) }}
                  >
                    {formatPercent(entry.share)}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-base text-ink">
                      {entry.category === 'Other' ? 'Unclassified' : entry.category}
                    </span>
                    <span className="block text-2xs text-subtle">
                      {formatExact(entry.prompts)} prompts
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <dl className="grid gap-x-10 sm:grid-cols-2">
            <Fact label="Most used tool" value={data.mostUsedTool?.name ?? '—'} />
            <Fact label="Most active project" value={data.mostActiveProject?.name ?? '—'} />
            <Fact
              label="Most active period"
              value={
                data.mostActivePeriod
                  ? `${formatHour(data.mostActivePeriod.fromHour)} – ${formatHour(data.mostActivePeriod.toHour)}`
                  : '—'
              }
            />
            <Fact label="Average session (active)" value={formatDuration(data.averageSessionMs)} />
            <Fact label="Total prompts" value={formatExact(data.totalPrompts)} />
            <Fact label="Total sessions" value={formatExact(data.totalSessions)} />
          </dl>

          {history.data?.firstActivityAt ? (
            <p className="mt-8 border-t border-line pt-4 text-2xs text-subtle">
              Recorded since {formatDate(history.data.firstActivityAt)}. Everything on this page was
              computed on this machine from your own activity.
            </p>
          ) : null}
        </div>
      )}
    </>
  );
}
