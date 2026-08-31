import { Lightbulb } from 'lucide-react';
import { FilterBar } from '@/components/layout/filter-bar';
import { PageHeader } from '@/components/layout/page';
import { Card } from '@/components/ui/primitives';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/states';
import { useFilters } from '@/hooks/useFilters';
import { useInsights } from '@/lib/queries';
import { formatExact } from '@/lib/utils';

export function InsightsPage() {
  const [filters] = useFilters();
  const query = useInsights(filters);
  const data = query.data;

  return (
    <>
      <PageHeader
        title="Insights"
        description="Only what the data supports. Every card states the evidence behind it."
      />
      <FilterBar dimensions={['provider', 'project']} />

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.isLoading || !data ? (
        <Card>
          <SkeletonRows rows={5} />
        </Card>
      ) : data.insights.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Lightbulb className="size-4" aria-hidden="true" />}
            title="Not enough data for an honest insight"
            description="AI Footprint will not invent a pattern from a handful of prompts. Keep working and come back — or widen the time range."
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {data.insights.map((insight) => (
              <Card key={insight.id} className="fade-in p-5">
                <p className="text-sm leading-relaxed font-medium text-ink">{insight.headline}</p>
                <p className="mt-2 text-xs leading-relaxed text-muted">{insight.detail}</p>
                <p className="mt-3 border-t border-line pt-2.5 font-mono text-2xs text-subtle">
                  {insight.evidence.metric} = {formatExact(insight.evidence.value)} · n ={' '}
                  {formatExact(insight.evidence.sampleSize)}
                  {insight.evidence.comparedWith ? ` · vs ${insight.evidence.comparedWith}` : ''}
                </p>
              </Card>
            ))}
          </div>

          {data.suppressed > 0 ? (
            <p className="mt-4 text-2xs text-subtle">
              {data.suppressed} further observation{data.suppressed === 1 ? ' was' : 's were'}{' '}
              suppressed for having too little data behind {data.suppressed === 1 ? 'it' : 'them'}.
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
