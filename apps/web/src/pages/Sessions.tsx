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
  formatCost,
  formatDate,
  formatDateTime,
  formatDuration,
  formatExact,
  formatNumber,
  formatRelative,
  formatTime,
} from '@/lib/utils';
import type { LiveSessionInfo, SessionSummary } from '@ai-footprint/shared';

/**
 * A session that is running at this moment. Claude Code keeps a file per live process, so this
 * costs a directory read, and when several sessions are open at once, "which of these is still
 * going" is a more urgent question than anything in the history below it.
 */
function LiveDot({ live, label = true }: { live?: LiveSessionInfo; label?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full text-2xs font-medium whitespace-nowrap text-positive',
        label && 'bg-positive/10 px-1.5 py-0.5',
      )}
      title={
        live
          ? `Running now — pid ${live.pid}${live.entrypoint ? `, launched from ${live.entrypoint}` : ''}`
          : 'Running now'
      }
    >
      <span className="relative flex size-1.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-positive opacity-60" />
        <span className="relative inline-flex size-1.5 rounded-full bg-positive" />
      </span>
      {label ? 'live' : null}
    </span>
  );
}

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
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

/** A log: dated entries, the clock in a gutter, newest first. Totals belong to Overview. */
function Row({
  session,
  selected,
  onSelect,
}: {
  session: SessionSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const focus = session.categories[0];

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected}
        className={cn(
          'flex w-full gap-3 px-4 py-2.5 text-left transition-colors hover:bg-sunken/60 sm:px-5',
          selected && 'bg-sunken',
        )}
      >
        <span
          className={cn(
            'tabular w-16 shrink-0 pt-px text-2xs whitespace-nowrap',
            selected ? 'text-accent' : 'text-subtle',
          )}
        >
          {formatTime(session.startedAt)}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-xs font-medium text-ink">
              {session.projectName ?? 'No project'}
            </span>
            {session.live ? <LiveDot live={session.live} /> : null}
            {focus ? (
              <span className="text-2xs text-subtle">{focus.category.toLowerCase()}</span>
            ) : null}
            {/* A session older than the window reports only the part inside it. */}
            {session.startedBeforeRange ? (
              <span className="text-2xs text-subtle/80">
                began {formatDate(session.startedAt)}, before this range
              </span>
            ) : null}
          </span>

          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-subtle">
            <span className="tabular text-muted">{formatExact(session.promptCount)} prompts</span>
            <span className="tabular">{formatDuration(session.activeMs)}</span>
            <span className="tabular">{formatNumber(session.toolCount)} tools</span>
            <span className="tabular">
              {formatNumber(session.inputTokens + session.outputTokens)} tok
            </span>
            {session.estimatedCostUsd !== null ? (
              <span className="tabular">{formatCost(session.estimatedCostUsd)}</span>
            ) : null}
            {session.primaryModel ? <Mono className="text-2xs">{session.primaryModel}</Mono> : null}
            <span className="truncate">{session.providerName}</span>
          </span>
        </span>
      </button>
    </li>
  );
}

/** One dated heading per day, carrying that day's own totals rather than the page's. */
function dayLabel(iso: string): string {
  return formatDate(iso);
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

  const days: Array<{ key: string; label: string; sessions: SessionSummary[] }> = [];
  for (const session of rows) {
    const key = session.startedAt.slice(0, 10);
    const last = days[days.length - 1];
    if (last && last.key === key) last.sessions.push(session);
    else days.push({ key, label: dayLabel(session.startedAt), sessions: [session] });
  }

  return (
    <>
      <PageHeader
        title="Sessions"
        description="Every conversation with an AI tool, newest first, with what is running right now at the top."
      />
      <FilterBar dimensions={['provider', 'project', 'model']} />

      {/* Started but silent: a session that opened moments ago has no events yet, so it appears
          on no chart. Saying so is the difference between "nothing is running" and "not yet". */}
      {(data?.liveOnly.length ?? 0) > 0 || (totals?.liveNow ?? 0) > 0 ? (
        <section className="mb-4 rounded-lg border border-positive/25 bg-positive/4 px-4 py-3">
          <h2 className="flex items-center gap-2 text-xs font-semibold text-ink">
            <LiveDot label={false} />
            {formatExact(totals?.liveNow ?? 0)} running right now
          </h2>
          {(data?.liveOnly.length ?? 0) > 0 ? (
            <ul className="mt-2 space-y-1">
              {data?.liveOnly.map((session) => (
                <li
                  key={session.externalId}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs"
                >
                  <span className="font-medium text-ink">
                    {session.name ?? session.externalId.slice(0, 8)}
                  </span>
                  <Mono className="truncate text-2xs">{session.workingDirectory ?? '—'}</Mono>
                  <span className="text-subtle">
                    started {formatRelative(session.startedAt)}
                    {session.entrypoint ? ` · ${session.entrypoint}` : ''} · nothing recorded yet
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {totals ? (
        <p className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-subtle">
          <span className="tabular text-muted">
            {formatExact(totals.sessions)} sessions in this range
          </span>
          <span aria-hidden="true">·</span>
          <span className="tabular">{formatNumber(totals.prompts)} prompts</span>
          <span aria-hidden="true">·</span>
          <span className="tabular">{formatDuration(totals.activeMs)} active</span>
          {totals.estimatedCostUsd !== null ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="tabular">{formatCost(totals.estimatedCostUsd)} at API prices</span>
            </>
          ) : null}
        </p>
      ) : null}

      <div
        className={cn(
          'grid items-start gap-4',
          selected ? 'xl:grid-cols-[minmax(0,1fr)_25rem]' : '',
        )}
      >
        <Card className="min-w-0 overflow-hidden p-0">
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
              {days.map((day) => {
                const prompts = day.sessions.reduce((sum, row) => sum + row.promptCount, 0);
                const active = day.sessions.reduce((sum, row) => sum + row.activeMs, 0);
                return (
                  <section key={day.key}>
                    <h2 className="flex flex-wrap items-baseline gap-x-3 border-y border-line bg-sunken/70 px-4 py-1.5 text-2xs sm:px-5">
                      <span className="font-medium tracking-wide text-ink uppercase">
                        {day.label}
                      </span>
                      <span className="tabular text-subtle">
                        {formatExact(day.sessions.length)}{' '}
                        {day.sessions.length === 1 ? 'session' : 'sessions'} ·{' '}
                        {formatNumber(prompts)} prompts · {formatDuration(active)}
                      </span>
                    </h2>
                    <ul className="divide-y divide-line/60">
                      {day.sessions.map((session) => (
                        <Row
                          key={session.id}
                          session={session}
                          selected={selected === session.id}
                          onSelect={() => setSelected(session.id)}
                        />
                      ))}
                    </ul>
                  </section>
                );
              })}

              <div className="flex items-center justify-between border-t border-line px-4 py-3 sm:px-5">
                <p className="text-2xs text-subtle">
                  Page {page + 1} · showing {formatExact(rows.length)} of{' '}
                  {formatExact(totals?.sessions ?? rows.length)}
                </p>
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

        {selected ? <Detail id={selected} onClose={() => setSelected(null)} /> : null}
      </div>
    </>
  );
}
