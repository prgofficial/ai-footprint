import type { SqliteConnection } from '../client';
import { buildEventWhere, type EventFilters } from '../filters';
import type { BucketRow, NamedCount, Totals } from './analytics';

/**
 * Rollups can express every filter except technology, which lives in its own per-event
 * table. Anything they cannot answer falls back to the event log rather than guessing.
 */
export function rollupsCanAnswer(filters: EventFilters): boolean {
  // Rollups carry no technology, event-type or sub-agent dimension. A question narrowed by any
  // of those has to be answered from the event log, or the filter is silently ignored.
  return !filters.technology && !filters.eventType && filters.includeSubagents !== false;
}

function buildRollupWhere(filters: EventFilters, days: { from: string; to: string }) {
  const clauses = ['r.day >= ?', 'r.day <= ?'];
  const params: unknown[] = [days.from, days.to];
  if (filters.providerId) {
    clauses.push('r.provider_id = ?');
    params.push(filters.providerId);
  }
  if (filters.projectId) {
    clauses.push('r.project_id = ?');
    params.push(filters.projectId);
  }
  if (filters.model) {
    clauses.push('r.model = ?');
    params.push(filters.model);
  }
  if (filters.category) {
    clauses.push('r.category = ?');
    params.push(filters.category);
  }
  return { sql: clauses.join(' AND '), params };
}

export class RollupReadRepository {
  constructor(private readonly connection: SqliteConnection) {}

  totals(
    filters: EventFilters,
    days: { from: string; to: string },
  ): Omit<Totals, 'sessions' | 'projects'> {
    const where = buildRollupWhere(filters, days);
    const row = this.connection
      .prepare(
        `SELECT COALESCE(SUM(r.prompts), 0) AS prompts,
                COALESCE(SUM(r.responses), 0) AS responses,
                COALESCE(SUM(r.tool_calls), 0) AS toolCalls,
                COALESCE(SUM(r.prompts + r.responses + r.tool_calls + r.other_events), 0) AS events,
                COALESCE(SUM(r.input_tokens), 0) AS inputTokens,
                COALESCE(SUM(r.output_tokens), 0) AS outputTokens,
                COALESCE(SUM(r.cache_read_tokens), 0) AS cacheReadTokens,
                COALESCE(SUM(r.cache_write_tokens), 0) AS cacheWriteTokens,
                SUM(r.estimated_cost_usd) AS estimatedCostUsd
         FROM daily_rollups r WHERE ${where.sql}`,
      )
      .get(...where.params) as Omit<Totals, 'sessions' | 'projects' | 'activeMs'>;

    return { ...row, activeMs: this.activeMs(filters, days) };
  }

  activeMs(filters: EventFilters, days: { from: string; to: string }): number {
    const clauses = ['a.day >= ?', 'a.day <= ?'];
    const params: unknown[] = [days.from, days.to];
    if (filters.providerId) {
      clauses.push('a.provider_id = ?');
      params.push(filters.providerId);
    }
    // Project, model and category are dimensions of the counter rollup, not of active time,
    // so a filtered active-time figure has to come from the event log instead.
    if (filters.projectId || filters.model || filters.category) return -1;

    const row = this.connection
      .prepare(
        `SELECT COALESCE(SUM(a.active_ms), 0) AS activeMs FROM daily_active a
         WHERE ${clauses.join(' AND ')}`,
      )
      .get(...params) as { activeMs: number };
    return row.activeMs;
  }

  /**
   * Null when the filter names a dimension `daily_active` does not carry, so the caller falls
   * back to the event log. Reporting the whole workspace's active time next to a filtered
   * prompt count in the same response is worse than reporting nothing.
   */
  activeMsByDay(
    filters: EventFilters,
    days: { from: string; to: string },
  ): Map<string, number> | null {
    if (filters.projectId || filters.model || filters.category) return null;

    const clauses = ['a.day >= ?', 'a.day <= ?'];
    const params: unknown[] = [days.from, days.to];
    if (filters.providerId) {
      clauses.push('a.provider_id = ?');
      params.push(filters.providerId);
    }
    const rows = this.connection
      .prepare(
        `SELECT a.day AS day, SUM(a.active_ms) AS activeMs FROM daily_active a
         WHERE ${clauses.join(' AND ')} GROUP BY a.day`,
      )
      .all(...params) as Array<{ day: string; activeMs: number }>;
    return new Map(rows.map((r) => [r.day, r.activeMs]));
  }

  buckets(filters: EventFilters, days: { from: string; to: string }, weekly: boolean): BucketRow[] {
    const where = buildRollupWhere(filters, days);
    const bucketExpr = weekly ? "strftime('%Y-W%W', r.day)" : 'r.day';
    const rows = this.connection
      .prepare(
        `SELECT ${bucketExpr} AS bucket,
                COALESCE(SUM(r.prompts), 0) AS prompts,
                COALESCE(SUM(r.input_tokens), 0) AS inputTokens,
                COALESCE(SUM(r.output_tokens), 0) AS outputTokens,
                SUM(r.estimated_cost_usd) AS estimatedCostUsd
         FROM daily_rollups r WHERE ${where.sql}
         GROUP BY bucket ORDER BY bucket`,
      )
      .all(...where.params) as Array<Omit<BucketRow, 'activeMs' | 'sessions'>>;

    // daily_rollups.sessions is per (day, provider, project, model, category), so summing it
    // counts one session once per dimension it touched. daily_active holds one honest count
    // per day, which is the grain a bucket needs. It carries no project/model/category, so a
    // query narrowed by those reports no session count rather than a wrong one.
    const sessionsByBucket =
      filters.projectId || filters.model || filters.category
        ? new Map<string, number>()
        : this.sessionsPerBucket(filters, days, weekly);

    return rows.map((row) => ({
      ...row,
      sessions: sessionsByBucket.get(row.bucket) ?? 0,
      activeMs: 0,
    }));
  }

  private sessionsPerBucket(
    filters: EventFilters,
    days: { from: string; to: string },
    weekly: boolean,
  ): Map<string, number> {
    const clauses = ['a.day >= ?', 'a.day <= ?'];
    const params: unknown[] = [days.from, days.to];
    if (filters.providerId) {
      clauses.push('a.provider_id = ?');
      params.push(filters.providerId);
    }
    const bucketExpr = weekly ? "strftime('%Y-W%W', a.day)" : 'a.day';
    const rows = this.connection
      .prepare(
        `SELECT ${bucketExpr} AS bucket, COALESCE(SUM(a.sessions), 0) AS sessions
         FROM daily_active a WHERE ${clauses.join(' AND ')}
         GROUP BY bucket`,
      )
      .all(...params) as Array<{ bucket: string; sessions: number }>;
    return new Map(rows.map((row) => [row.bucket, row.sessions]));
  }

  by(
    dimension: 'provider_id' | 'project_id' | 'model' | 'category',
    filters: EventFilters,
    days: { from: string; to: string },
    limit = 100,
  ): NamedCount[] {
    const where = buildRollupWhere(filters, days);
    const nameJoin =
      dimension === 'project_id'
        ? 'LEFT JOIN projects p ON p.id = r.project_id'
        : dimension === 'provider_id'
          ? 'LEFT JOIN providers p ON p.id = r.provider_id'
          : '';
    const nameExpr = nameJoin ? `COALESCE(p.name, r.${dimension})` : `r.${dimension}`;

    return this.connection
      .prepare(
        `SELECT r.${dimension} AS key, ${nameExpr} AS name, SUM(r.prompts) AS count
         FROM daily_rollups r ${nameJoin}
         WHERE ${where.sql} AND r.${dimension} != ''
         GROUP BY r.${dimension} HAVING count > 0
         ORDER BY count DESC LIMIT ?`,
      )
      .all(...where.params, limit) as NamedCount[];
  }

  /**
   * A transcript records the model on the reply, never on the prompt, so a model breakdown
   * has to be counted on replies. `by()` counts prompts and would report nothing here.
   */
  models(filters: EventFilters, days: { from: string; to: string }, limit = 100): NamedCount[] {
    const where = buildRollupWhere(filters, days);
    return this.connection
      .prepare(
        `SELECT r.model AS key, r.model AS name, SUM(r.responses) AS count
         FROM daily_rollups r
         WHERE ${where.sql} AND r.model != ''
         GROUP BY r.model HAVING count > 0
         ORDER BY count DESC LIMIT ?`,
      )
      .all(...where.params, limit) as NamedCount[];
  }

  categories(
    filters: EventFilters,
    days: { from: string; to: string },
  ): Array<NamedCount & { avgConfidence: number }> {
    const where = buildRollupWhere(filters, days);
    return this.connection
      .prepare(
        `SELECT CASE WHEN r.category = '' THEN 'Other' ELSE r.category END AS key,
                CASE WHEN r.category = '' THEN 'Other' ELSE r.category END AS name,
                SUM(r.prompts) AS count,
                CASE WHEN SUM(r.prompts) > 0
                     THEN SUM(r.confidence_sum) / SUM(r.prompts) ELSE 0 END AS avgConfidence
         FROM daily_rollups r WHERE ${where.sql}
         GROUP BY key HAVING count > 0 ORDER BY count DESC`,
      )
      .all(...where.params) as Array<NamedCount & { avgConfidence: number }>;
  }

  /**
   * Counted from the event log, as the short-range path counts. Session rows carry no model or
   * category to filter on, and counting overlapping intervals credited a long IDE session to
   * every window it straddled, so an empty period could report sessions > 0.
   */
  sessionsInRange(filters: EventFilters, range: { from: string; to: string }): number {
    const where = buildEventWhere({ ...filters, from: range.from, to: range.to });
    const row = this.connection
      .prepare(
        `SELECT COUNT(DISTINCT e.session_id) AS n FROM events e
          WHERE ${where.sql} AND e.session_id IS NOT NULL`,
      )
      .get(...where.params) as { n: number };
    return row.n;
  }

  projectsInRange(filters: EventFilters, days: { from: string; to: string }): number {
    const where = buildRollupWhere(filters, days);
    const row = this.connection
      .prepare(
        `SELECT COUNT(DISTINCT r.project_id) AS n FROM daily_rollups r
         WHERE ${where.sql} AND r.project_id != ''`,
      )
      .get(...where.params) as { n: number };
    return row.n;
  }
}
