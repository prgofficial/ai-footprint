export interface EventFilters {
  from?: string;
  to?: string;
  /**
   * Local-day bounds, which REPLACE the instant bounds when present. Rollups are keyed on each
   * event's own local date, so filtering the log by UTC instant put an event inside one path's
   * window and outside the other's.
   */
  fromDay?: string;
  toDay?: string;
  providerId?: string;
  projectId?: string;
  model?: string;
  category?: string;
  technology?: string;
  eventType?: string;
  includeSubagents?: boolean;
}

export interface WhereClause {
  sql: string;
  params: unknown[];
}

/**
 * Single place where a user-supplied filter becomes SQL. Every value is bound, never
 * interpolated, so no filter can alter the shape of a query.
 */
export function buildEventWhere(filters: EventFilters, alias = 'e'): WhereClause {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.fromDay || filters.toDay) {
    if (filters.fromDay) {
      clauses.push(`${alias}.local_date >= ?`);
      params.push(filters.fromDay);
    }
    if (filters.toDay) {
      clauses.push(`${alias}.local_date <= ?`);
      params.push(filters.toDay);
    }
  } else {
    if (filters.from) {
      clauses.push(`${alias}.timestamp >= ?`);
      params.push(filters.from);
    }
    if (filters.to) {
      clauses.push(`${alias}.timestamp <= ?`);
      params.push(filters.to);
    }
  }
  if (filters.providerId) {
    clauses.push(`${alias}.provider_id = ?`);
    params.push(filters.providerId);
  }
  if (filters.projectId) {
    clauses.push(`${alias}.project_id = ?`);
    params.push(filters.projectId);
  }
  if (filters.model) {
    clauses.push(`${alias}.model = ?`);
    params.push(filters.model);
  }
  if (filters.eventType) {
    clauses.push(`${alias}.event_type = ?`);
    params.push(filters.eventType);
  }
  if (filters.includeSubagents === false) {
    clauses.push(`${alias}.is_subagent = 0`);
  }
  if (filters.category) {
    clauses.push(
      `EXISTS (SELECT 1 FROM classifications c WHERE c.event_id = ${alias}.id AND c.category = ?)`,
    );
    params.push(filters.category);
  }
  if (filters.technology) {
    clauses.push(
      `EXISTS (SELECT 1 FROM technologies t WHERE t.event_id = ${alias}.id AND t.technology = ?)`,
    );
    params.push(filters.technology);
  }

  return { sql: clauses.length > 0 ? clauses.join(' AND ') : '1 = 1', params };
}

export interface Cursor {
  timestamp: string;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.timestamp}|${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    const separator = decoded.lastIndexOf('|');
    if (separator < 0) return null;
    const timestamp = decoded.slice(0, separator);
    const id = decoded.slice(separator + 1);
    if (!timestamp || !id) return null;
    return { timestamp, id };
  } catch {
    return null;
  }
}
