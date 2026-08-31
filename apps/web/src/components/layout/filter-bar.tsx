import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { RANGE_OPTIONS, activeFilterCount, useFilters } from '@/hooks/useFilters';
import { useCategories, useModels, useProjects, useProviders, type Filters } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { Button } from '../ui/primitives';

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="sr-only">{label}</span>
      <select
        // A value the option list has not loaded yet (or no longer contains) makes the select
        // fall back to its first option, so a page filtered from a link read "All sources"
        // while it was filtered. The value is offered explicitly below when that happens.
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || undefined)}
        className={cn(
          'h-7 rounded-md border border-line bg-raised px-2 text-xs text-ink',
          'max-w-[13rem] truncate hover:border-line-strong',
          value && 'border-accent/50 text-accent',
        )}
      >
        <option value="">{label}</option>
        {value && !options.some((option) => option.value === value) ? (
          <option value={value}>{value}</option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function RangeTabs({
  filters,
  onChange,
}: {
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
}) {
  return (
    <div
      className="inline-flex rounded-md border border-line bg-raised p-0.5"
      role="group"
      aria-label="Time range"
    >
      {RANGE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={filters.range === option.value}
          onClick={() => onChange({ range: option.value })}
          className={cn(
            'rounded px-2.5 py-1 text-xs font-medium transition-colors',
            filters.range === option.value ? 'bg-sunken text-ink' : 'text-subtle hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function FilterBar({
  showRange = true,
  extra,
  dimensions = ['provider', 'project', 'category', 'model'],
}: {
  showRange?: boolean;
  extra?: ReactNode;
  dimensions?: Array<'provider' | 'project' | 'category' | 'model' | 'technology'>;
}) {
  const [filters, update, reset] = useFilters();
  const allTime: Filters = { range: 'all' };
  const providers = useProviders();
  const projects = useProjects(allTime);
  const categories = useCategories(allTime);
  const models = useModels(allTime);
  const count = activeFilterCount(filters);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {showRange ? <RangeTabs filters={filters} onChange={update} /> : null}

      {dimensions.includes('provider') ? (
        <Select
          label="All sources"
          value={filters.providerId}
          onChange={(value) => update({ providerId: value })}
          options={(providers.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
        />
      ) : null}

      {dimensions.includes('project') ? (
        <Select
          label="All projects"
          value={filters.projectId}
          onChange={(value) => update({ projectId: value })}
          options={(projects.data ?? []).map((p) => ({ value: p.projectId, label: p.name }))}
        />
      ) : null}

      {dimensions.includes('category') ? (
        <Select
          label="All categories"
          value={filters.category}
          onChange={(value) => update({ category: value })}
          options={(categories.data ?? []).map((c) => ({ value: c.category, label: c.category }))}
        />
      ) : null}

      {dimensions.includes('model') ? (
        <Select
          label="All models"
          value={filters.model}
          onChange={(value) => update({ model: value })}
          options={(models.data ?? []).map((m) => ({ value: m.model, label: m.model }))}
        />
      ) : null}

      {extra}

      {count > 0 ? (
        <Button size="sm" variant="ghost" onClick={reset}>
          <X className="size-3" aria-hidden="true" />
          Clear {count} filter{count === 1 ? '' : 's'}
        </Button>
      ) : null}
    </div>
  );
}
