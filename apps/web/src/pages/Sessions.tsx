import { useState } from 'react';
import { ChevronLeft, ChevronRight, Radio, X } from 'lucide-react';
import { FilterBar } from '@/components/layout/filter-bar';
import { PageHeader } from '@/components/layout/page';
import {
  Badge,
  Bar,
  Button,
  Card,
  CardHeader,
  Kpi,
  Mono,
  Stat,
  StatGrid,
} from '@/components/ui/primitives';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/states';
import { useFilters } from '@/hooks/useFilters';
import { useSessionDetail, useSessions } from '@/lib/queries';
import {
  chartColor,
  cn,
  formatCost,
  formatDate,
  formatDateTime,
  formatDuration,
  formatExact,
  formatNumber,
  formatRelative,
  formatTime,
} from '@/lib/utils';
import type { LiveSessionInfo } from '@ai-footprint/shared';

/**
 * A session that is running at this moment. Claude Code keeps a file per live process, so this
 * costs a directory read, and when several sessions are open at once, "which of these is still
 * going" is a more urgent question than anything in the history below it.
 */
function LiveDot({ live }: { live: LiveSessionInfo }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-positive/10 px-1.5 py-0.5 text-2xs font-medium whitespace-nowrap text-positive"
      title={`Running now — pid ${live.pid}${live.entrypoint ? `, launched from ${live.entrypoint}` : ''}`}
    >
      <span className="relative flex size-1.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-positive opacity-60" />
        <span className="relative inline-flex size-1.5 rounded-full bg-positive" />
      </span>
      live
    </span>
  );
}

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
          <h2 className="flex items-center gap-2 truncate text-sm font-semibold text-ink">
            <span className="truncate">{session?.projectName ?? 'Session'}</span>
            {session?.live ? <LiveDot live={session.live} /> : null}
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
                <dt className="text-2xs text-subtle">Estimated cost</dt>
                <dd className="tabular text-ink">{formatCost(session.estimatedCostUsd)}</dd>
              </div>
              <div>
                <dt className="text-2xs text-subtle">Source</dt>
                <dd className="truncate text-ink">{session.providerName}</dd>
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
            {session.timeline.length > 200 ? (
              <p className="px-4 pb-4 text-2xs text-subtle">
                Showing the first 200 of {formatExact(session.timeline.length)} entries.
              </p>
            ) : null}
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

  const data = query.data;
  const rows = data?.items ?? [];
  const totals = data?.totals;
  const leader = Math.max(...rows.map((row) => row.promptCount), 1);
  const sources = new Set(rows.map((row) => row.providerName));

  return (
    <>
      <PageHeader
        title="Sessions"
        description="Each conversation with an AI tool. Every figure is what happened inside the selected range."
        actions={
          totals && totals.liveNow > 0 ? (
            <span className="flex items-center gap-1.5 rounded-full bg-positive/10 px-2.5 py-1 text-2xs font-medium text-positive">
              <Radio className="size-3" aria-hidden="true" />
              {totals.liveNow} running now
            </span>
          ) : null
        }
      />
      <FilterBar dimensions={['provider', 'project', 'model']} />

      {/* Started but silent: a session that opened moments ago has no events yet, so it appears
          on no chart. Saying so is the difference between "nothing is running" and "not yet". */}
      {(data?.liveOnly.length ?? 0) > 0 ? (
        <Card className="mb-4 border-positive/25">
          <CardHeader
            title="Running now, nothing recorded yet"
            description="These sessions are open but have not produced any activity in this range."
          />
          <ul className="divide-y divide-line">
            {data?.liveOnly.map((session) => (
              <li
                key={session.externalId}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-xs"
              >
                <span className="relative flex size-1.5 shrink-0">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-positive opacity-60" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-positive" />
                </span>
                <span className="font-medium text-ink">
                  {session.name ?? session.externalId.slice(0, 8)}
                </span>
                <Mono className="truncate">{session.workingDirectory ?? '—'}</Mono>
                <span className="ml-auto text-2xs text-subtle">
                  started {formatRelative(session.startedAt)}
                  {session.entrypoint ? ` · ${session.entrypoint}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {totals ? (
        <div className="mb-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              label="Sessions"
              value={formatExact(totals.sessions)}
              sub={`${sources.size} ${sources.size === 1 ? 'source' : 'sources'} in this selection`}
              series={rows.map((row) => row.promptCount).reverse()}
            />
            <Kpi
              label="Prompts"
              value={formatExact(totals.prompts)}
              sub="inside this range"
              series={rows.map((row) => row.promptCount).reverse()}
            />
            <Kpi
              label="Active time"
              value={formatDuration(totals.activeMs)}
              sub="idle gaps excluded"
              series={rows.map((row) => row.activeMs).reverse()}
            />
            <Kpi
              label="Estimated cost"
              value={formatCost(totals.estimatedCostUsd)}
              sub="at list API prices"
              series={rows.map((row) => row.estimatedCostUsd ?? 0).reverse()}
            />
          </div>

          <StatGrid>
            <Stat label="Running now" value={formatExact(totals.liveNow)} sub="live sessions" />
            <Stat
              label="Per session"
              value={
                totals.sessions > 0
                  ? formatExact(Math.round(totals.prompts / totals.sessions))
                  : '—'
              }
              sub="prompts on average"
            />
            <Stat
              label="Longest"
              value={formatDuration(Math.max(...rows.map((row) => row.activeMs), 0))}
              sub="active time"
            />
            <Stat
              label="Busiest"
              value={formatExact(Math.max(...rows.map((row) => row.promptCount), 0))}
              sub="prompts in one session"
            />
            <Stat
              label="Projects"
              value={formatExact(new Set(rows.map((r) => r.projectName).filter(Boolean)).size)}
              sub="touched"
            />
            <Stat label="Sources" value={formatExact(sources.size)} sub={[...sources].join(', ')} />
            <Stat
              label="Tool calls"
              value={formatNumber(rows.reduce((sum, row) => sum + row.toolCount, 0))}
              sub="on this page"
            />
            <Stat
              label="Shown"
              value={`${formatExact(rows.length)}`}
              sub={`of ${formatExact(totals.sessions)} sessions`}
            />
          </StatGrid>
        </div>
      ) : null}

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
          ) : rows.length === 0 ? (
            <EmptyState
              title="No sessions in this range"
              description="Sessions appear as soon as AI Footprint has imported activity."
              compact
            />
          ) : (
            <>
              <ul className="divide-y divide-line">
                {rows.map((session, index) => {
                  const focus = session.categories[0];
                  return (
                    <li key={session.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(session.id)}
                        aria-current={selected === session.id}
                        className={cn(
                          'w-full px-5 py-3 text-left transition-colors hover:bg-sunken/60',
                          selected === session.id && 'bg-sunken',
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                          <span
                            className="size-1.5 shrink-0 rounded-full"
                            style={{ background: chartColor(index) }}
                            aria-hidden="true"
                          />
                          <span className="truncate text-xs font-medium text-ink">
                            {session.projectName ?? 'No project'}
                          </span>
                          {session.live ? <LiveDot live={session.live} /> : null}
                          <Badge tone="muted">{session.providerName}</Badge>
                          {focus ? (
                            <span className="text-2xs text-subtle">
                              mostly {focus.category.toLowerCase()}
                            </span>
                          ) : null}
                          <span className="tabular ml-auto shrink-0 text-xs text-ink">
                            {formatExact(session.promptCount)} prompts
                          </span>
                        </div>

                        <Bar
                          value={(session.promptCount / leader) * 100}
                          color={chartColor(index)}
                          className={cn('mt-2', index === 0 ? '' : 'opacity-75')}
                        />

                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-subtle">
                          <span>{formatDateTime(session.startedAt)}</span>
                          <span className="tabular">{formatDuration(session.activeMs)} active</span>
                          <span className="tabular">{formatNumber(session.toolCount)} tools</span>
                          <span className="tabular">
                            {formatNumber(session.inputTokens + session.outputTokens)} tok
                          </span>
                          {session.estimatedCostUsd !== null ? (
                            <span className="tabular">{formatCost(session.estimatedCostUsd)}</span>
                          ) : null}
                          {session.primaryModel ? (
                            <Mono className="text-2xs">{session.primaryModel}</Mono>
                          ) : null}
                          {/* A session older than the window reports only the part inside it. */}
                          {session.startedBeforeRange ? (
                            <span className="text-subtle/80">
                              began {formatDate(session.startedAt)}, before this range
                            </span>
                          ) : null}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>

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
                    disabled={!data?.nextCursor}
                    onClick={() => {
                      const next = data?.nextCursor ?? undefined;
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
