import type { SqliteConnection } from '../client';
import { buildEventWhere, decodeCursor, encodeCursor, type EventFilters } from '../filters';

export interface Totals {
  events: number;
  prompts: number;
  responses: number;
  toolCalls: number;
  sessions: number;
  projects: number;
  activeMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedCostUsd: number | null;
}

export interface BucketRow {
  bucket: string;
  prompts: number;
  sessions: number;
  activeMs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
}

export interface NamedCount {
  key: string;
  name: string;
  count: number;
}

export interface ActivityRow {
  id: string;
  timestamp: string;
  eventType: string;
  providerId: string;
  providerName: string;
  model: string | null;
  projectId: string | null;
  projectName: string | null;
  sessionId: string | null;
  category: string | null;
  categoryConfidence: number | null;
  preview: string | null;
  toolName: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  isSubagent: number;
}

const EMPTY_TOTALS: Totals = {
  events: 0,
  prompts: 0,
  responses: 0,
  toolCalls: 0,
  sessions: 0,
  projects: 0,
  activeMs: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  estimatedCostUsd: null,
};

export class AnalyticsRepository {
  constructor(private readonly connection: SqliteConnection) {}

  totals(filters: EventFilters, idleTimeoutMs = 300_000, tailAllowanceMs = 60_000): Totals {
    const where = buildEventWhere(filters);
    const row = this.connection
      .prepare(
        `SELECT
           COUNT(*) AS events,
           SUM(CASE WHEN e.event_type = 'prompt' THEN 1 ELSE 0 END) AS prompts,
           SUM(CASE WHEN e.event_type = 'response' THEN 1 ELSE 0 END) AS responses,
           SUM(CASE WHEN e.event_type = 'tool_call' THEN 1 ELSE 0 END) AS toolCalls,
           COUNT(DISTINCT e.session_id) AS sessions,
           COUNT(DISTINCT e.project_id) AS projects,
           COALESCE(SUM(e.input_tokens), 0) AS inputTokens,
           COALESCE(SUM(e.output_tokens), 0) AS outputTokens,
           COALESCE(SUM(e.cache_read_tokens), 0) AS cacheReadTokens,
           COALESCE(SUM(e.cache_write_tokens), 0) AS cacheWriteTokens,
           SUM(e.estimated_cost_usd) AS estimatedCostUsd
         FROM events e WHERE ${where.sql}`,
      )
      .get(...where.params) as Partial<Totals> | undefined;

    const activeMs = this.activeMs(filters, idleTimeoutMs, tailAllowanceMs);
    if (!row) return { ...EMPTY_TOTALS, activeMs };
    return {
      ...EMPTY_TOTALS,
      ...row,
      events: row.events ?? 0,
      prompts: row.prompts ?? 0,
      responses: row.responses ?? 0,
      toolCalls: row.toolCalls ?? 0,
      sessions: row.sessions ?? 0,
      projects: row.projects ?? 0,
      activeMs,
    };
  }

  /**
   * §6.4 over the requested slice: consecutive events per session, each gap clamped to the idle
   * timeout, plus one tail allowance per session-DAY. Per session-day because that is what
   * `daily_active` charges; per session made short and long ranges disagree.
   */
  activeMs(filters: EventFilters, idleTimeoutMs = 300_000, tailAllowanceMs = 60_000): number {
    const where = buildEventWhere(filters);
    const row = this.connection
      .prepare(
        `WITH ordered AS (
           SELECT e.session_id AS sid, e.local_date AS day, e.timestamp AS ts,
                  LAG(e.timestamp) OVER (PARTITION BY e.session_id ORDER BY e.timestamp) AS prev
           FROM events e WHERE ${where.sql} AND e.session_id IS NOT NULL
         )
         SELECT
           COALESCE((
             SELECT SUM(MIN(MAX((julianday(ts) - julianday(prev)) * 86400000, 0), ?))
             FROM ordered WHERE prev IS NOT NULL
           ), 0) AS gaps,
           (SELECT COUNT(DISTINCT sid || '|' || day) FROM ordered) AS sessionDays`,
      )
      .get(...where.params, idleTimeoutMs) as { gaps: number; sessionDays: number };
    return Math.round(row.gaps) + row.sessionDays * tailAllowanceMs;
  }

  buckets(filters: EventFilters, granularity: 'hour' | 'day' | 'week'): BucketRow[] {
    const where = buildEventWhere(filters);
    const bucketExpr =
      granularity === 'hour'
        ? "e.local_date || 'T' || printf('%02d', e.local_hour)"
        : granularity === 'week'
          ? "strftime('%Y-W%W', e.local_date)"
          : 'e.local_date';

    const rows = this.connection
      .prepare(
        `SELECT ${bucketExpr} AS bucket,
                SUM(CASE WHEN e.event_type = 'prompt' THEN 1 ELSE 0 END) AS prompts,
                COUNT(DISTINCT e.session_id) AS sessions,
                COALESCE(SUM(e.input_tokens), 0) AS inputTokens,
                COALESCE(SUM(e.output_tokens), 0) AS outputTokens,
                SUM(e.estimated_cost_usd) AS estimatedCostUsd
         FROM events e WHERE ${where.sql}
         GROUP BY bucket ORDER BY bucket`,
      )
      .all(...where.params) as Array<Omit<BucketRow, 'activeMs'>>;

    return rows.map((row) => ({ ...row, activeMs: 0 }));
  }

  activeMsByDay(
    filters: EventFilters,
    idleTimeoutMs = 300_000,
    tailAllowanceMs = 60_000,
  ): Map<string, number> {
    const where = buildEventWhere(filters);
    const rows = this.connection
      .prepare(
        `WITH ordered AS (
           SELECT e.local_date AS day, e.session_id AS sid, e.timestamp AS ts,
                  -- Partitioned by session alone, so the gap that spans midnight is measured
                  -- and charged to the day of its later event instead of being discarded.
                  LAG(e.timestamp) OVER (PARTITION BY e.session_id ORDER BY e.timestamp) AS prev
           FROM events e WHERE ${where.sql} AND e.session_id IS NOT NULL
         )
         SELECT day,
                COALESCE(SUM(CASE WHEN prev IS NULL THEN 0
                  ELSE MIN(MAX((julianday(ts) - julianday(prev)) * 86400000, 0), ?) END), 0) AS gaps,
                COUNT(DISTINCT sid) AS sessions
         FROM ordered GROUP BY day`,
      )
      .all(...where.params, idleTimeoutMs) as Array<{
      day: string;
      gaps: number;
      sessions: number;
    }>;
    return new Map(rows.map((r) => [r.day, Math.round(r.gaps) + r.sessions * tailAllowanceMs]));
  }

  byProvider(filters: EventFilters): NamedCount[] {
    const where = buildEventWhere(filters);
    return this.connection
      .prepare(
        `SELECT e.provider_id AS key, COALESCE(p.name, e.provider_id) AS name,
                SUM(CASE WHEN e.event_type = 'prompt' THEN 1 ELSE 0 END) AS count
         FROM events e LEFT JOIN providers p ON p.id = e.provider_id
         WHERE ${where.sql}
         GROUP BY e.provider_id ORDER BY count DESC`,
      )
      .all(...where.params) as NamedCount[];
  }

  byCategory(filters: EventFilters): Array<NamedCount & { avgConfidence: number }> {
    const where = buildEventWhere({ ...filters, eventType: 'prompt' });
    return this.connection
      .prepare(
        `SELECT COALESCE(c.category, 'Other') AS key, COALESCE(c.category, 'Other') AS name,
                COUNT(*) AS count, COALESCE(AVG(c.confidence), 0) AS avgConfidence
         FROM events e LEFT JOIN classifications c ON c.event_id = e.id
         WHERE ${where.sql}
         GROUP BY key ORDER BY count DESC`,
      )
      .all(...where.params) as Array<NamedCount & { avgConfidence: number }>;
  }

  byProject(filters: EventFilters, limit = 100): NamedCount[] {
    const where = buildEventWhere({ ...filters, eventType: 'prompt' });
    return this.connection
      .prepare(
        `SELECT e.project_id AS key, COALESCE(p.name, 'Unknown') AS name, COUNT(*) AS count
         FROM events e LEFT JOIN projects p ON p.id = e.project_id
         WHERE ${where.sql} AND e.project_id IS NOT NULL
         GROUP BY e.project_id ORDER BY count DESC LIMIT ?`,
      )
      .all(...where.params, limit) as NamedCount[];
  }

  byTechnology(filters: EventFilters, limit = 100): NamedCount[] {
    const where = buildEventWhere({ ...filters, eventType: 'prompt' });
    return this.connection
      .prepare(
        `SELECT t.technology AS key, t.technology AS name, COUNT(*) AS count
         FROM events e JOIN technologies t ON t.event_id = e.id
         WHERE ${where.sql}
         GROUP BY t.technology ORDER BY count DESC LIMIT ?`,
      )
      .all(...where.params, limit) as NamedCount[];
  }

  byContext(filters: EventFilters, technology?: string): Array<NamedCount> {
    const where = buildEventWhere({ ...filters, eventType: 'prompt' });
    const params = [...where.params];
    let extra = '';
    if (technology) {
      extra =
        ' AND EXISTS (SELECT 1 FROM technologies t2 WHERE t2.event_id = e.id AND t2.technology = ?)';
      params.push(technology);
    }
    return this.connection
      .prepare(
        `SELECT cx.context AS key, cx.context AS name, COUNT(*) AS count
         FROM events e JOIN contexts cx ON cx.event_id = e.id
         WHERE ${where.sql}${extra}
         GROUP BY cx.context ORDER BY count DESC`,
      )
      .all(...params) as NamedCount[];
  }

  byModel(filters: EventFilters): Array<{
    model: string;
    modelFamily: string | null;
    events: number;
    prompts: number;
    responses: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    estimatedCostUsd: number | null;
  }> {
    const where = buildEventWhere(filters);
    return this.connection
      .prepare(
        `SELECT e.model AS model, e.model_family AS modelFamily, COUNT(*) AS events,
                SUM(CASE WHEN e.event_type = 'prompt' THEN 1 ELSE 0 END) AS prompts,
                SUM(CASE WHEN e.event_type = 'response' THEN 1 ELSE 0 END) AS responses,
                COALESCE(SUM(e.input_tokens), 0) AS inputTokens,
                COALESCE(SUM(e.output_tokens), 0) AS outputTokens,
                COALESCE(SUM(e.cache_read_tokens), 0) AS cacheReadTokens,
                COALESCE(SUM(e.cache_write_tokens), 0) AS cacheWriteTokens,
                SUM(e.estimated_cost_usd) AS estimatedCostUsd
         FROM events e WHERE ${where.sql} AND e.model IS NOT NULL
         GROUP BY e.model ORDER BY events DESC`,
      )
      .all(...where.params) as never;
  }

  activeHours(filters: EventFilters): Array<{ hour: number; prompts: number }> {
    const where = buildEventWhere({ ...filters, eventType: 'prompt' });
    const rows = this.connection
      .prepare(
        `SELECT e.local_hour AS hour, COUNT(*) AS prompts FROM events e
         WHERE ${where.sql} GROUP BY hour ORDER BY hour`,
      )
      .all(...where.params) as Array<{ hour: number; prompts: number }>;
    const filled = Array.from({ length: 24 }, (_, hour) => ({ hour, prompts: 0 }));
    for (const row of rows) {
      const slot = filled[row.hour];
      if (slot) slot.prompts = row.prompts;
    }
    return filled;
  }

  activeWeekdays(filters: EventFilters): Array<{ weekday: number; prompts: number }> {
    const where = buildEventWhere({ ...filters, eventType: 'prompt' });
    const rows = this.connection
      .prepare(
        `SELECT e.local_weekday AS weekday, COUNT(*) AS prompts FROM events e
         WHERE ${where.sql} GROUP BY weekday ORDER BY weekday`,
      )
      .all(...where.params) as Array<{ weekday: number; prompts: number }>;
    const filled = Array.from({ length: 7 }, (_, weekday) => ({ weekday, prompts: 0 }));
    for (const row of rows) {
      const slot = filled[row.weekday];
      if (slot) slot.prompts = row.prompts;
    }
    return filled;
  }

  categoryTrend(
    filters: EventFilters,
    granularity: 'day' | 'week',
  ): Array<{ bucket: string; category: string; count: number }> {
    const where = buildEventWhere({ ...filters, eventType: 'prompt' });
    const bucketExpr = granularity === 'week' ? "strftime('%Y-W%W', e.local_date)" : 'e.local_date';
    return this.connection
      .prepare(
        `SELECT ${bucketExpr} AS bucket, COALESCE(c.category, 'Other') AS category, COUNT(*) AS count
         FROM events e LEFT JOIN classifications c ON c.event_id = e.id
         WHERE ${where.sql}
         GROUP BY bucket, category ORDER BY bucket`,
      )
      .all(...where.params) as Array<{ bucket: string; category: string; count: number }>;
  }

  activity(
    filters: EventFilters,
    options: { limit: number; cursor?: string },
  ): { items: ActivityRow[]; nextCursor: string | null } {
    const where = buildEventWhere(filters);
    const params = [...where.params];
    const clauses = [where.sql];

    const cursor = decodeCursor(options.cursor);
    if (cursor) {
      clauses.push('(e.timestamp, e.id) < (?, ?)');
      params.push(cursor.timestamp, cursor.id);
    }

    const rows = this.connection
      .prepare(
        `SELECT e.id, e.timestamp, e.event_type AS eventType, e.provider_id AS providerId,
                COALESCE(pr.name, e.provider_id) AS providerName, e.model,
                e.project_id AS projectId, pj.name AS projectName, e.session_id AS sessionId,
                c.category, c.confidence AS categoryConfidence, p.preview,
                tc.tool_name AS toolName, e.input_tokens AS inputTokens,
                e.output_tokens AS outputTokens, e.is_subagent AS isSubagent
         FROM events e
         LEFT JOIN providers pr ON pr.id = e.provider_id
         LEFT JOIN projects pj ON pj.id = e.project_id
         LEFT JOIN classifications c ON c.event_id = e.id
         LEFT JOIN prompts p ON p.event_id = e.id
         LEFT JOIN tool_calls tc ON tc.event_id = e.id
         WHERE ${clauses.join(' AND ')}
         ORDER BY e.timestamp DESC, e.id DESC
         LIMIT ?`,
      )
      .all(...params, options.limit + 1) as ActivityRow[];

    const items = rows.slice(0, options.limit);
    const last = items[items.length - 1];
    const nextCursor =
      rows.length > options.limit && last
        ? encodeCursor({ timestamp: last.timestamp, id: last.id })
        : null;
    return { items, nextCursor };
  }

  sessions(
    filters: EventFilters,
    options: { limit: number; cursor?: string },
  ): { items: SessionRow[]; nextCursor: string | null } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters.from) {
      clauses.push('s.started_at >= ?');
      params.push(filters.from);
    }
    if (filters.to) {
      clauses.push('s.started_at <= ?');
      params.push(filters.to);
    }
    if (filters.providerId) {
      clauses.push('s.provider_id = ?');
      params.push(filters.providerId);
    }
    if (filters.projectId) {
      clauses.push('s.project_id = ?');
      params.push(filters.projectId);
    }
    if (filters.model) {
      clauses.push('s.primary_model = ?');
      params.push(filters.model);
    }

    const cursor = decodeCursor(options.cursor);
    if (cursor) {
      clauses.push('(s.started_at, s.id) < (?, ?)');
      params.push(cursor.timestamp, cursor.id);
    }

    const rows = this.connection
      .prepare(
        `SELECT s.id, s.provider_id AS providerId, s.external_id AS externalId,
                s.project_id AS projectId, pj.name AS projectName, s.primary_model AS primaryModel,
                s.started_at AS startedAt, s.ended_at AS endedAt, s.duration_ms AS durationMs,
                s.active_ms AS activeMs, s.prompt_count AS promptCount, s.tool_count AS toolCount,
                s.input_tokens AS inputTokens, s.output_tokens AS outputTokens,
                s.estimated_cost_usd AS estimatedCostUsd
         FROM sessions s LEFT JOIN projects pj ON pj.id = s.project_id
         WHERE ${clauses.length > 0 ? clauses.join(' AND ') : '1 = 1'}
         ORDER BY s.started_at DESC, s.id DESC LIMIT ?`,
      )
      .all(...params, options.limit + 1) as SessionRow[];

    const items = rows.slice(0, options.limit);
    const last = items[items.length - 1];
    const nextCursor =
      rows.length > options.limit && last
        ? encodeCursor({ timestamp: last.startedAt, id: last.id })
        : null;
    return { items, nextCursor };
  }

  sessionCategories(sessionIds: string[]): Map<string, Array<{ category: string; count: number }>> {
    const out = new Map<string, Array<{ category: string; count: number }>>();
    if (sessionIds.length === 0) return out;
    const placeholders = sessionIds.map(() => '?').join(',');
    const rows = this.connection
      .prepare(
        `SELECT e.session_id AS sessionId, c.category, COUNT(*) AS count
         FROM events e JOIN classifications c ON c.event_id = e.id
         WHERE e.session_id IN (${placeholders})
         GROUP BY e.session_id, c.category ORDER BY count DESC`,
      )
      .all(...sessionIds) as Array<{ sessionId: string; category: string; count: number }>;
    for (const row of rows) {
      const list = out.get(row.sessionId) ?? [];
      list.push({ category: row.category, count: row.count });
      out.set(row.sessionId, list);
    }
    return out;
  }

  sessionTimeline(
    sessionId: string,
    limit = 500,
  ): Array<{
    id: string;
    timestamp: string;
    eventType: string;
    model: string | null;
    toolName: string | null;
    category: string | null;
    preview: string | null;
    isSubagent: number;
  }> {
    return this.connection
      .prepare(
        `SELECT e.id, e.timestamp, e.event_type AS eventType, e.model,
                tc.tool_name AS toolName, c.category, p.preview, e.is_subagent AS isSubagent
         FROM events e
         LEFT JOIN tool_calls tc ON tc.event_id = e.id
         LEFT JOIN classifications c ON c.event_id = e.id
         LEFT JOIN prompts p ON p.event_id = e.id
         WHERE e.session_id = ? ORDER BY e.timestamp LIMIT ?`,
      )
      .all(sessionId, limit) as never;
  }

  projectDetails(filters: EventFilters, limit: number): ProjectAggregateRow[] {
    const where = buildEventWhere(filters);
    return this.connection
      .prepare(
        `SELECT pj.id AS projectId, pj.name, pj.path, pj.repository,
                SUM(CASE WHEN e.event_type = 'prompt' THEN 1 ELSE 0 END) AS prompts,
                COUNT(DISTINCT e.session_id) AS sessions,
                MAX(e.timestamp) AS lastActivityAt,
                COALESCE((SELECT SUM(s.active_ms) FROM sessions s WHERE s.project_id = pj.id), 0) AS activeMs
         FROM events e JOIN projects pj ON pj.id = e.project_id
         WHERE ${where.sql}
         GROUP BY pj.id ORDER BY prompts DESC LIMIT ?`,
      )
      .all(...where.params, limit) as ProjectAggregateRow[];
  }

  topPerProject(
    projectIds: string[],
    dimension: 'category' | 'technology' | 'model',
  ): Map<string, Array<{ key: string; count: number }>> {
    const out = new Map<string, Array<{ key: string; count: number }>>();
    if (projectIds.length === 0) return out;
    const placeholders = projectIds.map(() => '?').join(',');
    const query =
      dimension === 'category'
        ? `SELECT e.project_id AS projectId, c.category AS key, COUNT(*) AS count
           FROM events e JOIN classifications c ON c.event_id = e.id
           WHERE e.project_id IN (${placeholders}) GROUP BY e.project_id, key ORDER BY count DESC`
        : dimension === 'technology'
          ? `SELECT e.project_id AS projectId, t.technology AS key, COUNT(*) AS count
             FROM events e JOIN technologies t ON t.event_id = e.id
             WHERE e.project_id IN (${placeholders}) GROUP BY e.project_id, key ORDER BY count DESC`
          : `SELECT e.project_id AS projectId, e.model AS key, COUNT(*) AS count
             FROM events e WHERE e.project_id IN (${placeholders}) AND e.model IS NOT NULL
             GROUP BY e.project_id, key ORDER BY count DESC`;

    const rows = this.connection.prepare(query).all(...projectIds) as Array<{
      projectId: string;
      key: string;
      count: number;
    }>;
    for (const row of rows) {
      const list = out.get(row.projectId) ?? [];
      if (list.length < 5) list.push({ key: row.key, count: row.count });
      out.set(row.projectId, list);
    }
    return out;
  }

  maxEventId(): string {
    const row = this.connection.prepare('SELECT COALESCE(MAX(id), "") AS id FROM events').get() as {
      id: string;
    };
    return row.id;
  }

  exportRows(filters: EventFilters, includePrompts: boolean): IterableIterator<ExportRow> {
    const where = buildEventWhere(filters);
    const promptText = includePrompts ? 'p.text' : 'NULL';
    return this.connection
      .prepare(
        `SELECT e.id, e.timestamp, e.event_type AS eventType, e.provider_id AS providerId,
                e.model, e.model_family AS modelFamily, e.session_id AS sessionId,
                e.project_id AS projectId, pj.name AS projectName, e.repository,
                e.git_branch AS gitBranch, e.working_directory AS workingDirectory,
                e.is_subagent AS isSubagent, e.input_tokens AS inputTokens,
                e.output_tokens AS outputTokens, e.cache_read_tokens AS cacheReadTokens,
                e.cache_write_tokens AS cacheWriteTokens, e.estimated_cost_usd AS estimatedCostUsd,
                e.duration_ms AS durationMs, e.source_version AS sourceVersion,
                e.tz_offset_minutes AS tzOffsetMinutes, e.local_date AS localDate,
                c.category, c.confidence AS categoryConfidence,
                ${promptText} AS promptText, p.char_length AS charLength,
                p.redaction_count AS redactionCount,
                (SELECT GROUP_CONCAT(t.technology) FROM technologies t WHERE t.event_id = e.id) AS technologies,
                tc.tool_name AS toolName
         FROM events e
         LEFT JOIN projects pj ON pj.id = e.project_id
         LEFT JOIN classifications c ON c.event_id = e.id
         LEFT JOIN prompts p ON p.event_id = e.id
         LEFT JOIN tool_calls tc ON tc.event_id = e.id
         WHERE ${where.sql}
         ORDER BY e.timestamp`,
      )
      .iterate(...where.params) as IterableIterator<ExportRow>;
  }
}

export interface SessionRow {
  id: string;
  providerId: string;
  externalId: string | null;
  projectId: string | null;
  projectName: string | null;
  primaryModel: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  activeMs: number;
  promptCount: number;
  toolCount: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
}

export interface ProjectAggregateRow {
  projectId: string;
  name: string;
  path: string | null;
  repository: string | null;
  prompts: number;
  sessions: number;
  activeMs: number;
  lastActivityAt: string | null;
}

export interface ExportRow {
  id: string;
  timestamp: string;
  eventType: string;
  providerId: string;
  model: string | null;
  modelFamily: string | null;
  sessionId: string | null;
  projectId: string | null;
  projectName: string | null;
  repository: string | null;
  gitBranch: string | null;
  workingDirectory: string | null;
  isSubagent: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  estimatedCostUsd: number | null;
  durationMs: number | null;
  sourceVersion: string | null;
  tzOffsetMinutes: number;
  localDate: string;
  category: string | null;
  categoryConfidence: number | null;
  promptText: string | null;
  charLength: number | null;
  redactionCount: number | null;
  technologies: string | null;
  toolName: string | null;
}
