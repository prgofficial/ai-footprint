import { Injectable } from '@nestjs/common';
import { extractThemes } from '@ai-footprint/analytics';
import { ACTIVE_TIME_TAIL_ALLOWANCE_MS } from '@ai-footprint/shared';
import { rollupsCanAnswer, type EventFilters } from '@ai-footprint/database';
import { localDateIn } from '@ai-footprint/database';
import type {
  ActivityItem,
  CategoryUsage,
  CostDelta,
  MetricDelta,
  ModelUsage,
  OverviewPeriod,
  OverviewResponse,
  Paginated,
  ProfileResponse,
  ProjectUsage,
  PromptAnalyticsResponse,
  PromptCategory,
  PromptDetail,
  PromptListItem,
  RangeQuery,
  ResolvedRange,
  SessionDetail,
  SessionSummary,
  TaskContext,
  TechnologyUsage,
  TimeseriesResponse,
} from '@ai-footprint/shared';
import { NotFound, StoreService } from '../common';
import { changePct, granularityFor, resolveRange } from './range';

interface Scope {
  range: ResolvedRange;
  filters: EventFilters;
  previous: EventFilters;
  idleTimeoutMs: number;
  /** Local day span of the range, which is the key rollups are stored under. */
  days: { from: string; to: string };
  previousDays: { from: string; to: string };
  useRollups: boolean;
}

/** Short ranges read the event log: it is fast at that size and carries per-event detail
 *  such as classifier confidence. Longer ranges read the rollups. */
const ROLLUP_THRESHOLD_DAYS = 8;

function share(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((count / total) * 1000) / 10;
}

function delta(value: number, previous: number): MetricDelta {
  return { value, previous, changePct: changePct(value, previous) };
}

/** A range with no priced model reports null, not zero: unknown and free are not the same. */
function costDelta(value: number | null, previous: number | null): CostDelta {
  return {
    value,
    previous,
    changePct: value === null || previous === null ? null : changePct(value, previous),
  };
}

/**
 * Claude Code stamps CLI-generated messages with a placeholder model in angle brackets
 * (`<synthetic>`). Nobody chose it, so it does not belong in a list of models used.
 */
function isRealModel(model: string | null | undefined): boolean {
  return !!model && !model.startsWith('<');
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100) / 100;
}

function splitList(value: string | null): string[] {
  if (!value) return [];
  return [...new Set(value.split(',').filter(Boolean))];
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly stores: StoreService) {}

  scope(query: RangeQuery): Scope {
    const settings = this.stores.settings();
    const timezone = query.timezone || settings.timezone;
    const range = resolveRange({
      range: query.range,
      from: query.from,
      to: query.to,
      timezone,
      earliest: this.stores.store.events.firstEventAt(),
    });

    const shared: EventFilters = {
      providerId: query.providerId,
      projectId: query.projectId,
      model: query.model,
      category: query.category,
      technology: query.technology,
    };

    const days = {
      from: localDateIn(timezone, new Date(range.from)),
      to: localDateIn(timezone, new Date(range.to)),
    };
    const previousDays = {
      from: localDateIn(timezone, new Date(range.previousFrom)),
      to: localDateIn(timezone, new Date(range.previousTo)),
    };
    // Day bounds, not instants: the rollups are keyed on the event's own local date, and the
    // two paths have to select the same events or a range can contain an event its superset
    // does not.
    const filters = { ...shared, fromDay: days.from, toDay: days.to };
    const spanDays = (Date.parse(range.to) - Date.parse(range.from)) / 86_400_000;

    return {
      range,
      filters,
      previous: { ...shared, fromDay: previousDays.from, toDay: previousDays.to },
      idleTimeoutMs: settings.idleTimeoutMinutes * 60_000,
      days,
      previousDays,
      useRollups: spanDays > ROLLUP_THRESHOLD_DAYS && rollupsCanAnswer(filters),
    };
  }

  private totalsFor(
    scope: Scope,
    filters: EventFilters,
    days: { from: string; to: string },
  ): ReturnType<typeof this.stores.store.analytics.totals> {
    const store = this.stores.store;
    if (!scope.useRollups) {
      return store.analytics.totals(filters, scope.idleTimeoutMs, ACTIVE_TIME_TAIL_ALLOWANCE_MS);
    }
    const rollup = store.rollupReads.totals(filters, days);
    const activeMs =
      rollup.activeMs >= 0
        ? rollup.activeMs
        : store.analytics.activeMs(filters, scope.idleTimeoutMs, ACTIVE_TIME_TAIL_ALLOWANCE_MS);
    return {
      ...rollup,
      activeMs,
      sessions: store.rollupReads.sessionsInRange(filters, {
        from: filters.from ?? scope.range.from,
        to: filters.to ?? scope.range.to,
      }),
      projects: store.rollupReads.projectsInRange(filters, days),
    };
  }

  overview(query: RangeQuery): OverviewResponse {
    const store = this.stores.store;
    const scope = this.scope(query);
    const { range, filters, previous } = scope;

    const current = this.totalsFor(scope, filters, scope.days);
    const prior = this.totalsFor(scope, previous, scope.previousDays);

    const providers = scope.useRollups
      ? store.rollupReads.by('provider_id', filters, scope.days)
      : store.analytics.byProvider(filters);
    const categories = scope.useRollups
      ? store.rollupReads.categories(filters, scope.days)
      : store.analytics.byCategory(filters);
    const projects = scope.useRollups
      ? store.rollupReads.by('project_id', filters, scope.days, 8)
      : store.analytics.byProject(filters, 8);
    const models = (
      scope.useRollups
        ? store.rollupReads.models(filters, scope.days, 8)
        : store.analytics.byModel(filters).map((row) => ({ key: row.model, count: row.responses }))
    ).filter((row) => isRealModel(row.key) && row.count > 0);
    const modelTotal = models.reduce((sum, row) => sum + row.count, 0);
    const technologies = store.analytics.byTechnology(filters, 10);

    const series = this.timeseries(query);
    const busiest = series.points.reduce<{ bucket: string; prompts: number } | null>(
      (best, point) => (best === null || point.prompts > best.prompts ? point : best),
      null,
    );

    const promptTotal = current.prompts;
    const period: OverviewPeriod = {
      prompts: delta(current.prompts, prior.prompts),
      sessions: delta(current.sessions, prior.sessions),
      activeMs: delta(current.activeMs, prior.activeMs),
      tokens: delta(
        current.inputTokens + current.outputTokens,
        prior.inputTokens + prior.outputTokens,
      ),
      toolCalls: delta(current.toolCalls, prior.toolCalls),
      estimatedCostUsd: costDelta(current.estimatedCostUsd, prior.estimatedCostUsd),
      inputTokens: current.inputTokens,
      outputTokens: current.outputTokens,
      cacheReadTokens: current.cacheReadTokens,
      cacheWriteTokens: current.cacheWriteTokens,
      projects: current.projects,
      promptsPerSession: ratio(current.prompts, current.sessions),
      msPerSession: current.sessions > 0 ? Math.round(current.activeMs / current.sessions) : 0,
      busiestBucket:
        busiest && busiest.prompts > 0
          ? { bucket: busiest.bucket, prompts: busiest.prompts }
          : null,
    };

    return {
      range,
      granularity: series.granularity,
      period,
      sources: providers.map((row) => ({
        providerId: row.key,
        name: row.name,
        prompts: row.count,
        share: share(row.count, promptTotal),
      })),
      categories: categories.map((row) => ({
        category: row.key as PromptCategory,
        prompts: row.count,
        share: share(row.count, promptTotal),
      })),
      projects: projects.map((row) => ({
        projectId: row.key,
        name: row.name,
        prompts: row.count,
        share: share(row.count, promptTotal),
      })),
      technologies: technologies.map((row) => ({
        technology: row.key,
        prompts: row.count,
        share: share(row.count, promptTotal),
      })),
      models: models.slice(0, 8).map((row) => ({
        model: row.key,
        responses: row.count,
        share: share(row.count, modelTotal),
      })),
      timeline: series.points,
      totals: {
        events: current.events,
        prompts: current.prompts,
        sessions: current.sessions,
        projects: current.projects,
      },
    };
  }

  timeseries(query: RangeQuery): TimeseriesResponse {
    const store = this.stores.store;
    const scope = this.scope(query);
    const { range, filters, idleTimeoutMs } = scope;
    const granularity = granularityFor(range);
    const buckets = scope.useRollups
      ? store.rollupReads.buckets(filters, scope.days, granularity === 'week')
      : store.analytics.buckets(filters, granularity);
    // The rollups carry no project/model/category dimension for active time, so a filtered
    // question falls back to the event log rather than being answered about everything.
    const activeByDay =
      (scope.useRollups ? store.rollupReads.activeMsByDay(filters, scope.days) : null) ??
      store.analytics.activeMsByDay(filters, idleTimeoutMs, ACTIVE_TIME_TAIL_ALLOWANCE_MS);

    return {
      range,
      granularity,
      points: buckets.map((bucket) => ({
        ...bucket,
        activeMs: granularity === 'day' ? (activeByDay.get(bucket.bucket) ?? 0) : 0,
      })),
    };
  }

  providers(query: RangeQuery) {
    const { filters } = this.scope(query);
    const rows = this.stores.store.analytics.byProvider(filters);
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    return rows.map((row) => ({
      providerId: row.key,
      name: row.name,
      prompts: row.count,
      share: share(row.count, total),
    }));
  }

  models(query: RangeQuery): ModelUsage[] {
    const { filters } = this.scope(query);
    const rows = this.stores.store.analytics
      .byModel(filters)
      .filter((row) => isRealModel(row.model));
    const total = rows.reduce((sum, row) => sum + row.events, 0);
    return rows.map((row) => ({ ...row, share: share(row.events, total) }));
  }

  categories(query: RangeQuery): CategoryUsage[] {
    const store = this.stores.store;
    const scope = this.scope(query);
    const { filters, previous } = scope;
    const rows = scope.useRollups
      ? store.rollupReads.categories(filters, scope.days)
      : store.analytics.byCategory(filters);
    const priorRows = scope.useRollups
      ? store.rollupReads.categories(previous, scope.previousDays)
      : store.analytics.byCategory(previous);
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    const priorTotal = priorRows.reduce((sum, row) => sum + row.count, 0);
    const priorByKey = new Map(priorRows.map((row) => [row.key, row.count]));

    return rows.map((row) => ({
      category: row.key as PromptCategory,
      prompts: row.count,
      share: share(row.count, total),
      avgConfidence: Math.round(row.avgConfidence * 100) / 100,
      previousShare: priorTotal > 0 ? share(priorByKey.get(row.key) ?? 0, priorTotal) : null,
    }));
  }

  technologies(query: RangeQuery): TechnologyUsage[] {
    const store = this.stores.store;
    const { filters } = this.scope(query);
    const rows = store.analytics.byTechnology(filters, 40);
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    return rows.map((row) => ({
      technology: row.key,
      prompts: row.count,
      share: share(row.count, total),
      contexts: store.analytics
        .byContext(filters, row.key)
        .slice(0, 4)
        .map((ctx) => ({ context: ctx.key as TaskContext, count: ctx.count })),
    }));
  }

  projects(query: RangeQuery): ProjectUsage[] {
    const store = this.stores.store;
    const { filters } = this.scope(query);
    const rows = store.analytics.projectDetails(filters, 100);
    const ids = rows.map((row) => row.projectId);
    const categories = store.analytics.topPerProject(ids, 'category');
    const technologies = store.analytics.topPerProject(ids, 'technology');
    const models = store.analytics.topPerProject(ids, 'model');

    return rows.map((row) => ({
      projectId: row.projectId,
      name: row.name,
      path: row.path,
      repository: row.repository,
      prompts: row.prompts,
      sessions: row.sessions,
      activeMs: row.activeMs,
      lastActivityAt: row.lastActivityAt,
      topCategories: (categories.get(row.projectId) ?? []).map((entry) => ({
        category: entry.key as PromptCategory,
        count: entry.count,
      })),
      topTechnologies: (technologies.get(row.projectId) ?? []).map((entry) => ({
        technology: entry.key,
        count: entry.count,
      })),
      topModels: (models.get(row.projectId) ?? []).map((entry) => ({
        model: entry.key,
        count: entry.count,
      })),
    }));
  }

  activity(
    query: RangeQuery & { limit: number; cursor?: string; eventType?: string },
  ): Paginated<ActivityItem> {
    const { filters } = this.scope(query);
    const page = this.stores.store.analytics.activity(
      { ...filters, eventType: query.eventType },
      { limit: query.limit, cursor: query.cursor },
    );
    return {
      items: page.items.map((row) => ({
        id: row.id,
        timestamp: row.timestamp,
        eventType: row.eventType as ActivityItem['eventType'],
        providerId: row.providerId,
        providerName: row.providerName,
        model: row.model,
        projectId: row.projectId,
        projectName: row.projectName,
        sessionId: row.sessionId,
        category: row.category as PromptCategory | null,
        categoryConfidence: row.categoryConfidence,
        preview: row.preview,
        toolName: row.toolName,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        isSubagent: row.isSubagent === 1,
      })),
      nextCursor: page.nextCursor,
    };
  }

  prompts(
    query: RangeQuery & { limit: number; cursor?: string; q?: string },
  ): Paginated<PromptListItem> {
    const { filters } = this.scope(query);
    const page = this.stores.store.prompts.search(filters, {
      query: query.q,
      limit: query.limit,
      cursor: query.cursor,
    });
    return {
      items: page.items.map((row) => ({
        id: row.id,
        timestamp: row.timestamp,
        eventType: 'prompt',
        providerId: row.providerId,
        providerName: row.providerName,
        model: row.model,
        projectId: row.projectId,
        projectName: row.projectName,
        sessionId: row.sessionId,
        category: row.category as PromptCategory | null,
        categoryConfidence: row.categoryConfidence,
        preview: row.preview,
        toolName: null,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        isSubagent: row.isSubagent === 1,
        charLength: row.charLength,
        wordLength: row.wordLength,
        redactionCount: row.redactionCount,
        technologies: splitList(row.technologies),
      })),
      nextCursor: page.nextCursor,
    };
  }

  promptDetail(id: string): PromptDetail {
    const row = this.stores.store.prompts.detail(id);
    if (!row) throw new NotFound('That prompt');
    return {
      id: row.id,
      timestamp: row.timestamp,
      eventType: 'prompt',
      providerId: row.providerId,
      providerName: row.providerName,
      model: row.model,
      projectId: row.projectId,
      projectName: row.projectName,
      sessionId: row.sessionId,
      category: row.category as PromptCategory | null,
      categoryConfidence: row.categoryConfidence,
      preview: row.preview,
      toolName: null,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      isSubagent: row.isSubagent === 1,
      charLength: row.charLength,
      wordLength: row.wordLength,
      redactionCount: row.redactionCount,
      technologies: splitList(row.technologies),
      text: row.text,
      textAvailable: row.text !== null,
      response: row.responseText,
      contexts: splitList(row.contexts) as TaskContext[],
      repository: row.repository,
      gitBranch: row.gitBranch,
      workingDirectory: row.workingDirectory,
      sourceVersion: row.sourceVersion,
      estimatedCostUsd: row.estimatedCostUsd,
      cacheReadTokens: row.cacheReadTokens,
      cacheWriteTokens: row.cacheWriteTokens,
    };
  }

  promptAnalytics(query: RangeQuery): PromptAnalyticsResponse {
    const store = this.stores.store;
    const { range, filters } = this.scope(query);
    const totals = store.analytics.totals(filters);
    const lengths = store.prompts.lengthStats(filters);
    const granularity = granularityFor(range) === 'week' ? 'week' : 'day';
    const trendRows = store.analytics.categoryTrend(filters, granularity);

    const trends = new Map<string, Record<string, number>>();
    for (const row of trendRows) {
      const bucket = trends.get(row.bucket) ?? {};
      bucket[row.category] = row.count;
      trends.set(row.bucket, bucket);
    }

    return {
      range,
      categories: this.categories(query),
      themes: extractThemes(store.prompts.textsForThemes(filters, 2000)),
      avgCharLength: Math.round(lengths.avgChars),
      avgWordLength: Math.round(lengths.avgWords),
      promptsPerSession:
        totals.sessions > 0 ? Math.round((totals.prompts / totals.sessions) * 10) / 10 : 0,
      repeated: store.prompts.repeated(filters, 12).map((row) => ({
        fingerprint: row.fingerprint,
        text: row.text ?? '',
        count: row.count,
        lastSeenAt: row.lastSeenAt,
      })),
      trends: [...trends.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([bucket, counts]) => ({ bucket, counts })),
      activeHours: store.analytics.activeHours(filters),
      activeDays: store.analytics.activeWeekdays(filters),
      topProjects: store.analytics
        .byProject(filters, 8)
        .map((row) => ({ projectId: row.key, name: row.name, prompts: row.count })),
      topTechnologies: store.analytics
        .byTechnology(filters, 12)
        .map((row) => ({ technology: row.key, prompts: row.count })),
    };
  }

  sessions(query: RangeQuery & { limit: number; cursor?: string }): Paginated<SessionSummary> {
    const store = this.stores.store;
    const { filters } = this.scope(query);
    const page = store.analytics.sessions(filters, { limit: query.limit, cursor: query.cursor });
    const categories = store.analytics.sessionCategories(page.items.map((row) => row.id));

    return {
      items: page.items.map((row) => ({
        ...row,
        categories: (categories.get(row.id) ?? []).slice(0, 5).map((entry) => ({
          category: entry.category as PromptCategory,
          count: entry.count,
        })),
      })),
      nextCursor: page.nextCursor,
    };
  }

  sessionDetail(id: string): SessionDetail {
    const store = this.stores.store;
    const page = store.analytics.sessions({}, { limit: 1000 });
    const summary = page.items.find((row) => row.id === id);
    if (!summary) throw new NotFound('That session');

    const categories = store.analytics.sessionCategories([id]);
    const timeline = store.analytics.sessionTimeline(id);

    return {
      ...summary,
      categories: (categories.get(id) ?? []).map((entry) => ({
        category: entry.category as PromptCategory,
        count: entry.count,
      })),
      timeline: timeline.map((row) => ({
        id: row.id,
        timestamp: row.timestamp,
        eventType: row.eventType as SessionDetail['timeline'][number]['eventType'],
        label: row.preview ?? row.toolName ?? row.eventType,
        model: row.model,
        toolName: row.toolName,
        category: row.category as PromptCategory | null,
        isSubagent: row.isSubagent === 1,
      })),
    };
  }

  profile(query: RangeQuery): ProfileResponse {
    const store = this.stores.store;
    const { range, filters } = this.scope(query);
    const totals = store.analytics.totals(filters);
    const categories = store.analytics.byCategory(filters);
    const providers = store.analytics.byProvider(filters);
    const projects = store.analytics.byProject(filters, 1);
    const hours = store.analytics.activeHours(filters);

    const providerTotal = providers.reduce((sum, row) => sum + row.count, 0);
    const topProvider = providers[0];
    const topProject = projects[0];
    const peak = peakWindow(hours);

    return {
      range,
      distribution: categories.map((row) => ({
        category: row.key as PromptCategory,
        share: share(row.count, totals.prompts),
        prompts: row.count,
      })),
      mostUsedTool: topProvider
        ? {
            providerId: topProvider.key,
            name: topProvider.name,
            share: share(topProvider.count, providerTotal),
          }
        : null,
      mostActiveProject: topProject
        ? { projectId: topProject.key, name: topProject.name, prompts: topProject.count }
        : null,
      mostActivePeriod: peak,
      averageSessionMs: totals.sessions > 0 ? Math.round(totals.activeMs / totals.sessions) : 0,
      totalPrompts: totals.prompts,
      totalSessions: totals.sessions,
      firstActivityAt: store.events.firstEventAt(),
      hasEnoughData: totals.prompts >= 10,
    };
  }
}

/** The busiest contiguous three-hour window, which reads better than a single peak hour. */
export function peakWindow(
  hours: Array<{ hour: number; prompts: number }>,
): { fromHour: number; toHour: number; prompts: number } | null {
  const total = hours.reduce((sum, entry) => sum + entry.prompts, 0);
  if (total === 0) return null;

  let best = { fromHour: 0, toHour: 3, prompts: -1 };
  for (let start = 0; start < 24; start++) {
    let sum = 0;
    for (let offset = 0; offset < 3; offset++) {
      sum += hours[(start + offset) % 24]?.prompts ?? 0;
    }
    if (sum > best.prompts) best = { fromHour: start, toHour: (start + 3) % 24, prompts: sum };
  }
  return best.prompts > 0 ? best : null;
}
