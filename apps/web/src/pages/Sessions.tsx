import { useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { FilterBar } from '@/components/layout/filter-bar';
import { PageHeader } from '@/components/layout/page';
import { Badge, Button, Card, Mono } from '@/components/ui/primitives';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/states';
import { useFilters } from '@/hooks/useFilters';
import { useSessionDetail, useSessions } from '@/lib/queries';
import {
  cn,
  formatDateTime,
  formatDuration,
  formatExact,
  formatNumber,
  formatTime,
} from '@/lib/utils';

function Timeline({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useSessionDetail(id);
  const session = query.data;

  return (
    <aside
      className="surface-card shadow-card fade-in sticky top-20 flex max-h-[calc(100vh-7rem)] flex-col overflow-hidden"
      aria-label="Session detail"
    >
      <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-ink">
            {session?.projectName ?? 'Session'}
          </h2>
          {session ? (
            <p className="mt-0.5 text-2xs text-subtle">
              {formatDateTime(session.startedAt)} · {formatDuration(session.activeMs)} active
            </p>
          ) : null}
        </div>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close session detail">
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {query.isError ? (
          <ErrorState error={query.error} compact />
        ) : !session ? (
          <SkeletonRows rows={6} />
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-b border-line px-4 py-3 text-xs">
              <div>
                <dt className="text-2xs text-subtle">Prompts</dt>
                <dd className="tabular text-ink">{formatExact(session.promptCount)}</dd>
              </div>
              <div>
                <dt className="text-2xs text-subtle">Tool calls</dt>
                <dd className="tabular text-ink">{formatExact(session.toolCount)}</dd>
              </div>
              <div>
                <dt className="text-2xs text-subtle">Duration</dt>
                <dd className="tabular text-ink">{formatDuration(session.durationMs)}</dd>
              </div>
              <div>
                <dt className="text-2xs text-subtle">Tokens</dt>
                <dd className="tabular text-ink">
                  {formatNumber(session.inputTokens + session.outputTokens)}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-2xs text-subtle">Model</dt>
                <dd className="text-ink">
                  {session.primaryModel ? <Mono>{session.primaryModel}</Mono> : '—'}
                </dd>
              </div>
              {session.categories.length > 0 ? (
                <div className="col-span-2">
                  <dt className="mb-1 text-2xs text-subtle">Areas</dt>
                  <dd className="flex flex-wrap gap-1">
                    {session.categories.map((category) => (
                      <Badge key={category.category} tone="muted">
                        {category.category === 'Other' ? 'unclassified' : category.category} ·{' '}
                        {category.count}
                      </Badge>
                    ))}
                  </dd>
                </div>
              ) : null}
            </dl>

            <ol className="relative px-4 py-3">
              <span
                className="absolute top-5 bottom-5 left-[1.32rem] w-px bg-line"
                aria-hidden="true"
              />
              {session.timeline.slice(0, 200).map((entry) => (
                <li key={entry.id} className="relative flex gap-3 py-1.5 pl-1">
                  <span
                    className={cn(
                      'z-10 mt-1.5 size-1.5 shrink-0 rounded-full ring-3 ring-raised',
                      entry.eventType === 'prompt' ? 'bg-accent' : 'bg-line-strong',
                    )}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'truncate text-xs',
                        entry.eventType === 'prompt' ? 'text-ink' : 'text-subtle',
                      )}
                    >
                      {entry.label}
                    </p>
                    <p className="text-2xs text-subtle">
                      {formatTime(entry.timestamp)}
                      {entry.isSubagent ? ' · subagent' : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </aside>
  );
}

export function SessionsPage() {
  const [filters] = useFilters();
  const [selected, setSelected] = useState<string | null>(null);
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [page, setPage] = useState(0);
  const query = useSessions(filters, cursors[page]);

  return (
    <>
      <PageHeader
        title="Sessions"
        description="Each conversation with an AI tool, with idle time excluded from the active total."
      />
      <FilterBar dimensions={['provider', 'project', 'model']} />

      <div
        className={cn(
          'grid gap-4',
          selected ? 'lg:grid-cols-[minmax(0,1fr)_24rem]' : 'grid-cols-1',
        )}
      >
        <Card className="min-w-0 overflow-hidden">
          {query.isError ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
          ) : query.isLoading ? (
            <SkeletonRows />
          ) : (query.data?.items.length ?? 0) === 0 ? (
            <EmptyState
              title="No sessions in this range"
              description="Sessions appear as soon as AI Footprint has imported activity."
              compact
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[46rem] text-xs">
                  <caption className="sr-only">AI sessions</caption>
                  <thead>
                    <tr className="border-b border-line text-left text-2xs tracking-wide text-subtle uppercase">
                      <th scope="col" className="px-5 py-2.5 font-medium">
                        Started
                      </th>
                      <th scope="col" className="px-3 py-2.5 font-medium">
                        Project
                      </th>
                      <th scope="col" className="px-3 py-2.5 font-medium">
                        Model
                      </th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">
                        Prompts
                      </th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">
                        Tools
                      </th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">
                        Active
                      </th>
                      <th scope="col" className="px-5 py-2.5 text-right font-medium">
                        Duration
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data?.items.map((session) => (
                      <tr
                        key={session.id}
                        onClick={() => setSelected(session.id)}
                        aria-current={selected === session.id}
                        className={cn(
                          'cursor-pointer border-b border-line/60 last:border-0 hover:bg-sunken/50',
                          selected === session.id && 'bg-sunken',
                        )}
                      >
                        <td className="px-5 py-3 whitespace-nowrap text-ink">
                          {formatDateTime(session.startedAt)}
                        </td>
                        <td className="max-w-[12rem] truncate px-3 py-3 text-muted">
                          {session.projectName ?? '—'}
                        </td>
                        <td className="px-3 py-3 font-mono text-2xs text-subtle">
                          {session.primaryModel ?? '—'}
                        </td>
                        <td className="tabular px-3 py-3 text-right text-ink">
                          {formatExact(session.promptCount)}
                        </td>
                        <td className="tabular px-3 py-3 text-right text-muted">
                          {formatExact(session.toolCount)}
                        </td>
                        <td className="tabular px-3 py-3 text-right text-muted">
                          {formatDuration(session.activeMs)}
                        </td>
                        <td className="tabular px-5 py-3 text-right text-subtle">
                          {formatDuration(session.durationMs)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between border-t border-line px-5 py-3">
                <p className="text-2xs text-subtle">Page {page + 1}</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    <ChevronLeft className="size-3" aria-hidden="true" />
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    disabled={!query.data?.nextCursor}
                    onClick={() => {
                      const next = query.data?.nextCursor ?? undefined;
                      setCursors((current) => {
                        const copy = [...current];
                        copy[page + 1] = next;
                        return copy;
                      });
                      setPage((p) => p + 1);
                    }}
                  >
                    Next
                    <ChevronRight className="size-3" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>

        {selected ? <Timeline id={selected} onClose={() => setSelected(null)} /> : null}
      </div>
    </>
  );
}
