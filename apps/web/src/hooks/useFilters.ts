import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Filters } from '@/lib/queries';

export const RANGE_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '3m', label: '3 months' },
  { value: 'all', label: 'All time' },
] as const;

const KEYS = [
  'range',
  'providerId',
  'projectId',
  'model',
  'category',
  'technology',
  'includeSubagents',
] as const;

/** Filters live in the URL so a view can be linked, reloaded and shared with yourself. */
export function useFilters(): [Filters, (patch: Partial<Filters>) => void, () => void] {
  const [params, setParams] = useSearchParams();

  const filters = useMemo<Filters>(() => {
    const value: Filters = { range: params.get('range') ?? '30d' };
    for (const key of KEYS) {
      if (key === 'range') continue;
      const found = params.get(key);
      if (found) value[key] = found;
    }
    return value;
  }, [params]);

  const update = useCallback(
    (patch: Partial<Filters>) => {
      const next = new URLSearchParams(params);
      for (const [key, raw] of Object.entries(patch)) {
        if (!raw) next.delete(key);
        else next.set(key, String(raw));
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const reset = useCallback(() => {
    const next = new URLSearchParams();
    next.set('range', filters.range);
    setParams(next, { replace: true });
  }, [filters.range, setParams]);

  return [filters, update, reset];
}

export function activeFilterCount(filters: Filters): number {
  return KEYS.filter((key) => key !== 'range' && filters[key]).length;
}
