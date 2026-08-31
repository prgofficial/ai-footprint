import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Terminal,
  TriangleAlert,
  Layers,
} from 'lucide-react';
import { FilterBar } from '@/components/layout/filter-bar';
import { PageHeader } from '@/components/layout/page';
import { Badge, Button, Card } from '@/components/ui/primitives';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/states';
import { useFilters } from '@/hooks/useFilters';
import { useActivity } from '@/lib/queries';
import { cn, formatDateTime, formatNumber } from '@/lib/utils';
import type { ActivityItem, EventType } from '@ai-footprint/shared';

const ICONS: Partial<Record<EventType, typeof MessageSquare>> = {
  prompt: MessageSquare,
  response: Bot,
  tool_call: Terminal,
  error: TriangleAlert,
  compaction: Layers,
};

const TYPE_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Everything' },
  { value: 'prompt', label: 'Prompts' },
  { value: 'response', label: 'Responses' },
  { value: 'tool_call', label: 'Tool calls' },
  { value: 'error', label: 'Errors' },
];

function Row({ item }: { item: ActivityItem }) {
  const Icon = ICONS[item.eventType] ?? MessageSquare;
  const label =
    item.preview ?? (item.toolName ? `${item.toolName}` : item.eventType.replace('_', ' '));

  return (
    <li className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-sunken/60">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-line bg-sunken text-subtle">
        <Icon className="size-3" aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1">
        <p className={cn('truncate text-xs', item.preview ? 'text-ink' : 'text-muted')}>
          {item.eventType === 'prompt' && item.id ? (
            <Link to={`/prompts?selected=${item.id}`} className="hover:text-accent">
              {label}
            </Link>
          ) : (
            label
          )}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-2xs text-subtle">
          <span>{formatDateTime(item.timestamp)}</span>
          {item.projectName ? <span className="truncate">{item.projectName}</span> : null}
          {item.model ? <span className="font-mono">{item.model}</span> : null}
          {item.isSubagent ? <Badge tone="muted">subagent</Badge> : null}
          {item.inputTokens || item.outputTokens ? (
            <span className="tabular">
              {formatNumber((item.inputTokens ?? 0) + (item.outputTokens ?? 0))} tok
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {item.category ? (
          <Badge
            tone={item.categoryConfidence && item.categoryConfidence >= 0.5 ? 'accent' : 'muted'}
          >
            {item.category === 'Other' ? 'unclassified' : item.category}
          </Badge>
        ) : null}
      </div>
    </li>
  );
}

export function ActivityPage() {
  const [filters] = useFilters();
  const [eventType, setEventType] = useState('');
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [page, setPage] = useState(0);
  const query = useActivity(filters, cursors[page], eventType || undefined);

  const reset = () => {
    setCursors([undefined]);
    setPage(0);
  };

  return (
    <>
      <PageHeader
        title="Activity"
        description="Everything AI Footprint has recorded, newest first."
      />

      <FilterBar
        dimensions={['provider', 'project', 'category', 'model']}
        extra={
          <label className="flex items-center gap-1.5">
            <span className="sr-only">Event type</span>
            <select
              value={eventType}
              onChange={(event) => {
                setEventType(event.target.value);
                reset();
              }}
              className={cn(
                'h-7 rounded-md border border-line bg-raised px-2 text-xs text-ink',
                eventType && 'border-accent/50 text-accent',
              )}
            >
              {TYPE_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        }
      />

      <Card>
        {query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
        ) : query.isLoading ? (
          <SkeletonRows />
        ) : (query.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            title="Nothing here yet"
            description="No activity matches these filters. Try widening the time range or clearing a filter."
            compact
          />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {query.data?.items.map((item) => (
                <Row key={item.id} item={item} />
              ))}
            </ul>

            <div className="flex items-center justify-between border-t border-line px-5 py-3">
              <p className="text-2xs text-subtle">
                Page {page + 1}
                {query.isFetching ? ' · updating' : ''}
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
    </>
  );
}
