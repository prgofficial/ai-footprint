import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import type {
  ActivityItem,
  BackfillProgress,
  CategoryUsage,
  DetectionResult,
  HealthResponse,
  InsightsResponse,
  ModelUsage,
  OverviewResponse,
  Paginated,
  ProfileResponse,
  ProjectUsage,
  PromptAnalyticsResponse,
  PromptDetail,
  PromptListItem,
  ProviderSummary,
  SessionDetail,
  SessionSummary,
  SettingsResponse,
  StorageResponse,
  SystemConfigResponse,
} from '@ai-footprint/shared';
import { apiGet, apiPatch, apiPost } from './api';

export interface Filters {
  range: string;
  from?: string;
  to?: string;
  providerId?: string;
  projectId?: string;
  model?: string;
  category?: string;
  technology?: string;
}

export function filterParams(filters: Filters): Record<string, string | undefined> {
  return {
    range: filters.range,
    from: filters.from,
    to: filters.to,
    providerId: filters.providerId,
    projectId: filters.projectId,
    model: filters.model,
    category: filters.category,
    technology: filters.technology,
  };
}

const ANALYTICS = '/api/analytics';

type Options<T> = Omit<UseQueryOptions<T, Error, T, readonly unknown[]>, 'queryKey' | 'queryFn'>;

export const useSystemConfig = () =>
  useQuery({
    queryKey: ['system', 'config'],
    queryFn: () => apiGet<SystemConfigResponse>('/api/system/config'),
    staleTime: 15_000,
  });

export const useHealth = () =>
  useQuery({
    queryKey: ['system', 'health'],
    queryFn: () => apiGet<HealthResponse>('/api/health'),
    refetchInterval: 30_000,
    retry: 1,
  });

export const useStorage = () =>
  useQuery({
    queryKey: ['system', 'storage'],
    queryFn: () => apiGet<StorageResponse>('/api/system/storage'),
  });

export const useProviders = (refetchInterval?: number) =>
  useQuery({
    queryKey: ['providers'],
    queryFn: () => apiGet<ProviderSummary[]>('/api/providers'),
    refetchInterval,
  });

export const useDetection = (providerId: string) =>
  useQuery({
    queryKey: ['providers', providerId, 'detect'],
    queryFn: () => apiGet<DetectionResult>(`/api/providers/${providerId}/detect`),
  });

export const useOverview = (filters: Filters, options?: Options<OverviewResponse>) =>
  useQuery({
    queryKey: ['overview', filters],
    queryFn: () => apiGet<OverviewResponse>(`${ANALYTICS}/overview`, filterParams(filters)),
    ...options,
  });

export const useModels = (filters: Filters) =>
  useQuery({
    queryKey: ['models', filters],
    queryFn: () => apiGet<ModelUsage[]>(`${ANALYTICS}/models`, filterParams(filters)),
  });

export const useProjects = (filters: Filters) =>
  useQuery({
    queryKey: ['projects', filters],
    queryFn: () => apiGet<ProjectUsage[]>(`${ANALYTICS}/projects`, filterParams(filters)),
  });

export const useCategories = (filters: Filters) =>
  useQuery({
    queryKey: ['categories', filters],
    queryFn: () => apiGet<CategoryUsage[]>(`${ANALYTICS}/categories`, filterParams(filters)),
  });

export const useInsights = (filters: Filters) =>
  useQuery({
    queryKey: ['insights', filters],
    queryFn: () => apiGet<InsightsResponse>(`${ANALYTICS}/insights`, filterParams(filters)),
  });

export const useProfile = (filters: Filters) =>
  useQuery({
    queryKey: ['profile', filters],
    queryFn: () => apiGet<ProfileResponse>(`${ANALYTICS}/profile`, filterParams(filters)),
  });

export const usePromptAnalytics = (filters: Filters) =>
  useQuery({
    queryKey: ['prompt-analytics', filters],
    queryFn: () =>
      apiGet<PromptAnalyticsResponse>(`${ANALYTICS}/prompts/analytics`, filterParams(filters)),
  });

export const useActivity = (filters: Filters, cursor?: string, eventType?: string) =>
  useQuery({
    queryKey: ['activity', filters, cursor, eventType],
    queryFn: () =>
      apiGet<Paginated<ActivityItem>>(`${ANALYTICS}/activity`, {
        ...filterParams(filters),
        cursor,
        eventType,
        limit: 50,
      }),
    placeholderData: (previous) => previous,
  });

export const usePrompts = (filters: Filters, search: string, cursor?: string) =>
  useQuery({
    queryKey: ['prompts', filters, search, cursor],
    queryFn: () =>
      apiGet<Paginated<PromptListItem>>(`${ANALYTICS}/prompts`, {
        ...filterParams(filters),
        q: search || undefined,
        cursor,
        limit: 50,
      }),
    placeholderData: (previous) => previous,
  });

export const usePromptDetail = (id: string | null) =>
  useQuery({
    queryKey: ['prompt', id],
    queryFn: () => apiGet<PromptDetail>(`${ANALYTICS}/prompts/${id}`),
    enabled: Boolean(id),
  });

export const useSessions = (filters: Filters, cursor?: string) =>
  useQuery({
    queryKey: ['sessions', filters, cursor],
    queryFn: () =>
      apiGet<Paginated<SessionSummary>>(`${ANALYTICS}/sessions`, {
        ...filterParams(filters),
        cursor,
        limit: 50,
      }),
    placeholderData: (previous) => previous,
  });

export const useSessionDetail = (id: string | null) =>
  useQuery({
    queryKey: ['session', id],
    queryFn: () => apiGet<SessionDetail>(`${ANALYTICS}/sessions/${id}`),
    enabled: Boolean(id),
  });

export const useSettings = () =>
  useQuery({ queryKey: ['settings'], queryFn: () => apiGet<SettingsResponse>('/api/settings') });

export function useUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<SettingsResponse>) =>
      apiPatch<SettingsResponse>('/api/settings', patch),
    onSuccess: (settings) => {
      client.setQueryData(['settings'], settings);
      void client.invalidateQueries();
    },
  });
}

export function useConnectProvider() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; backfill: boolean; installHooks: boolean }) =>
      apiPost<{ connected: boolean; message: string; warnings: string[] }>(
        `/api/providers/${input.id}/connect`,
        { backfill: input.backfill, installHooks: input.installHooks },
      ),
    onSuccess: () => void client.invalidateQueries(),
  });
}

export function useDisconnectProvider() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiPost<{ ok: true }>(`/api/providers/${id}/disconnect`),
    onSuccess: () => void client.invalidateQueries(),
  });
}

export function useSetProviderEnabled() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) =>
      apiPost<{ ok: true }>(`/api/providers/${input.id}/${input.enabled ? 'enable' : 'disable'}`),
    onSuccess: () => void client.invalidateQueries(),
  });
}

export function useStartBackfill() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiPost<BackfillProgress>(`/api/providers/${id}/backfill`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['providers'] }),
  });
}

export function useCompleteOnboarding() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<SettingsResponse>('/api/settings/onboarding-complete'),
    onSuccess: () => {
      // Written straight into the cache: the onboarding gate reads this synchronously on
      // the next render, and an invalidation alone would let it redirect back to the wizard.
      client.setQueryData<SystemConfigResponse>(['system', 'config'], (current) =>
        current ? { ...current, onboardingComplete: true } : current,
      );
      void client.invalidateQueries();
    },
  });
}

export function useDeleteData() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (scope: Record<string, unknown>) =>
      apiPost<{ events: number; prompts: number }>('/api/data/delete', scope),
    onSuccess: () => void client.invalidateQueries(),
  });
}

export function useDeletePreview() {
  return useMutation({
    mutationFn: (scope: Record<string, unknown>) =>
      apiPost<{ events: number; prompts: number; sessions: number; projects: number }>(
        '/api/data/delete/preview',
        scope,
      ),
  });
}

export function useOverrideCategory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; category: string }) =>
      apiPost<{ ok: true }>(`/api/events/${input.id}/classify`, { category: input.category }),
    onSuccess: () => void client.invalidateQueries(),
  });
}
