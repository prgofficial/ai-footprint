import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Search, ShieldCheck, X } from 'lucide-react';
import { FilterBar } from '@/components/layout/filter-bar';
import { PageHeader } from '@/components/layout/page';
import { Badge, Button, Card, Mono } from '@/components/ui/primitives';
import { EmptyState, ErrorState, InlineNote, SkeletonRows } from '@/components/ui/states';
import { useFilters } from '@/hooks/useFilters';
import { useOverrideCategory, usePromptDetail, usePrompts } from '@/lib/queries';
import { cn, formatDateTime, formatExact, formatNumber, formatPercent } from '@/lib/utils';
import { PROMPT_CATEGORIES } from '@ai-footprint/shared';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <div className="flex items-baseline gap-3 py-1.5">
      <dt className="w-28 shrink-0 text-2xs tracking-wide text-subtle uppercase">{label}</dt>
      <dd className="min-w-0 flex-1 text-xs break-words text-ink">{children}</dd>
    </div>
  );
}

/**
 * Brief §20: the heuristic is allowed to be wrong, so the person reading it can correct it.
 * An override is stored with source 'user' and is never recomputed by the classifier.
 */
function CategoryOverride({ id, current }: { id: string; current: string | null }) {
  const override = useOverrideCategory();
  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">Change category</span>
      <select
        value={current ?? 'Other'}
        disabled={override.isPending}
        onChange={(event) => override.mutate({ id, category: event.target.value })}
        className="h-6 rounded border border-line bg-raised px-1.5 text-2xs text-muted hover:border-line-strong"
      >
        {PROMPT_CATEGORIES.map((category) => (
          <option key={category} value={category}>
            {category}
          </option>
        ))}
      </select>
    </label>
  );
}

function DetailPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const query = usePromptDetail(id);
  const prompt = query.data;

  return (
    <aside
      className="surface-card shadow-card fade-in sticky top-20 flex max-h-[calc(100vh-7rem)] flex-col overflow-hidden"
      aria-label="Prompt detail"
    >
      <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">Prompt detail</h2>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close detail">
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {query.isError ? (
          <ErrorState error={query.error} compact />
        ) : !prompt ? (
          <SkeletonRows rows={5} />
        ) : (
          <>
            {prompt.redactionCount > 0 ? (
              <div className="mb-3">
                <InlineNote tone="warning">
                  <ShieldCheck className="mr-1 inline size-3" aria-hidden="true" />
                  {prompt.redactionCount} secret{prompt.redactionCount === 1 ? '' : 's'} redacted
                  before storage.
                </InlineNote>
              </div>
            ) : null}

            {prompt.textAvailable ? (
              <pre className="mb-4 max-h-72 overflow-auto rounded-md border border-line bg-sunken p-3 font-mono text-xs whitespace-pre-wrap text-ink">
                {prompt.text}
              </pre>
            ) : (
              <div className="mb-4">
                <InlineNote>
                  Prompt text is not stored. Metadata-only mode is on, or prompt history was
                  deleted.
                </InlineNote>
              </div>
            )}

            <dl className="divide-y divide-line/60">
              <Field label="When">{formatDateTime(prompt.timestamp)}</Field>
              <Field label="Project">{prompt.projectName}</Field>
              <Field label="Repository">{prompt.repository}</Field>
              <Field label="Branch">
                {prompt.gitBranch ? <Mono>{prompt.gitBranch}</Mono> : null}
              </Field>
              <Field label="Directory">
                {prompt.workingDirectory ? <Mono>{prompt.workingDirectory}</Mono> : null}
              </Field>
              <Field label="Source">{prompt.providerName}</Field>
              <Field label="Model">{prompt.model ? <Mono>{prompt.model}</Mono> : null}</Field>
              <Field label="Session">
                {prompt.sessionId ? <Mono>{prompt.sessionId.slice(0, 12)}</Mono> : null}
              </Field>
              <Field label="Category">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone="accent">
                    {!prompt.category || prompt.category === 'Other'
                      ? 'unclassified'
                      : prompt.category}
                  </Badge>
                  {prompt.categoryConfidence !== null && prompt.categoryConfidence < 1 ? (
                    <span className="text-2xs text-subtle">
                      {formatPercent(prompt.categoryConfidence * 100)} confidence
                    </span>
                  ) : null}
                  <CategoryOverride id={prompt.id} current={prompt.category} />
                </span>
              </Field>
              <Field label="Context">
                {prompt.contexts.length > 0 ? (
                  <span className="flex flex-wrap gap-1">
                    {prompt.contexts.map((context) => (
                      <Badge key={context}>{context}</Badge>
                    ))}
                  </span>
                ) : null}
              </Field>
              <Field label="Technologies">
                {prompt.technologies.length > 0 ? (
                  <span className="flex flex-wrap gap-1">
                    {prompt.technologies.map((technology) => (
                      <Badge key={technology}>{technology}</Badge>
                    ))}
                  </span>
                ) : null}
              </Field>
              <Field label="Length">
                {formatExact(prompt.charLength)} characters · {formatExact(prompt.wordLength)} words
              </Field>
              <Field label="Tokens">
                {prompt.inputTokens || prompt.outputTokens ? (
                  <span className="tabular">
                    {formatNumber(prompt.inputTokens)} in · {formatNumber(prompt.outputTokens)} out
                    {prompt.cacheReadTokens
                      ? ` · ${formatNumber(prompt.cacheReadTokens)} cached`
                      : ''}
                  </span>
                ) : null}
              </Field>
              {/* The tool that produced it, not a hard-coded name: every source was labelled
                  "Claude Code" regardless of where the prompt actually came from. */}
              <Field label={prompt.providerName}>
                {prompt.sourceVersion ? <Mono>{prompt.sourceVersion}</Mono> : null}
              </Field>
            </dl>
          </>
        )}
      </div>
    </aside>
  );
}

/**
 * Sub-agent prompts are written by the assistant, not typed, and are two thirds of what is
 * stored here. The default is what you wrote; the rest is one click away.
 */
function AuthorToggle() {
  const [filters, update] = useFilters();
  const mode = filters.includeSubagents === 'false' ? 'you' : 'all';

  return (
    <div
      className="inline-flex rounded-md border border-line bg-sunken p-0.5"
      role="group"
      aria-label="Prompt author"
    >
      {(
        [
          ['you', 'You', 'false'],
          ['all', 'Everything', undefined],
        ] as const
      ).map(([key, label, value]) => (
        <button
          key={key}
          type="button"
          aria-pressed={mode === key}
          onClick={() => update({ includeSubagents: value })}
          className={cn(
            'rounded px-2.5 py-1 text-2xs font-medium whitespace-nowrap transition-colors',
            mode === key ? 'bg-raised text-ink shadow-card' : 'text-subtle hover:text-ink',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function PromptsPage() {
  const [filters] = useFilters();
  const [params, setParams] = useSearchParams();
  const selected = params.get('selected');

  const [input, setInput] = useState(params.get('q') ?? '');
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [page, setPage] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(input);
      setCursors([undefined]);
      setPage(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [input]);

  const query = usePrompts(filters, search, cursors[page]);

  const select = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('selected', id);
    else next.delete('selected');
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Prompts"
        description="Search what you asked. Nothing leaves this machine."
      />

      <FilterBar
        dimensions={['provider', 'project', 'category', 'model']}
        extra={
          <>
            <AuthorToggle />
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-subtle"
                aria-hidden="true"
              />
              <input
                type="search"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Search prompts"
                aria-label="Search prompts"
                className="h-7 w-56 rounded-md border border-line bg-raised pr-2 pl-7 text-xs text-ink placeholder:text-subtle"
              />
            </div>
          </>
        }
      />

      <div
        className={cn(
          'grid gap-4',
          selected ? 'lg:grid-cols-[minmax(0,1fr)_26rem]' : 'grid-cols-1',
        )}
      >
        <Card className="min-w-0">
          {query.isError ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
          ) : query.isLoading ? (
            <SkeletonRows />
          ) : (query.data?.items.length ?? 0) === 0 ? (
            <EmptyState
              title={search ? 'No prompts match that search' : 'No prompts recorded yet'}
              description={
                search
                  ? 'Try a different word, or widen the time range.'
                  : 'Once a tool is connected, every prompt you write becomes searchable here.'
              }
              compact
            />
          ) : (
            <>
              <ul className="divide-y divide-line">
                {query.data?.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => select(item.id)}
                      aria-current={selected === item.id}
                      className={cn(
                        'w-full px-5 py-3 text-left transition-colors hover:bg-sunken/60',
                        selected === item.id && 'bg-sunken',
                      )}
                    >
                      <p className="truncate text-xs text-ink">
                        {item.preview ?? 'Prompt text not stored'}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-2xs text-subtle">
                        <span>{formatDateTime(item.timestamp)}</span>
                        {item.projectName ? (
                          <span className="truncate">{item.projectName}</span>
                        ) : null}
                        {item.category ? (
                          <Badge tone="muted">
                            {item.category === 'Other' ? 'unclassified' : item.category}
                          </Badge>
                        ) : null}
                        {item.technologies.slice(0, 3).map((technology) => (
                          <Badge key={technology}>{technology}</Badge>
                        ))}
                        {item.redactionCount > 0 ? (
                          <span className="flex items-center gap-1 text-accent">
                            <ShieldCheck className="size-2.5" aria-hidden="true" />
                            {item.redactionCount}
                          </span>
                        ) : null}
                      </div>
                    </button>
                  </li>
                ))}
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

        {selected ? <DetailPanel id={selected} onClose={() => select(null)} /> : null}
      </div>
    </>
  );
}
