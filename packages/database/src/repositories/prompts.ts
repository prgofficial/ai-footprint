import type { SqliteConnection } from '../client';
import { buildEventWhere, decodeCursor, encodeCursor, type EventFilters } from '../filters';

export interface PromptListRow {
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
  charLength: number;
  wordLength: number;
  redactionCount: number;
  isSubagent: number;
  inputTokens: number | null;
  outputTokens: number | null;
  technologies: string | null;
}

export interface PromptDetailRow extends PromptListRow {
  text: string | null;
  responseText: string | null;
  contexts: string | null;
  repository: string | null;
  gitBranch: string | null;
  workingDirectory: string | null;
  sourceVersion: string | null;
  estimatedCostUsd: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
}

const SELECT_COLUMNS = `
  e.id, e.timestamp, e.event_type AS eventType, e.provider_id AS providerId,
  pr.name AS providerName, e.model, e.project_id AS projectId, pj.name AS projectName,
  e.session_id AS sessionId, c.category, c.confidence AS categoryConfidence,
  p.preview, p.char_length AS charLength, p.word_length AS wordLength,
  p.redaction_count AS redactionCount, e.is_subagent AS isSubagent,
  e.input_tokens AS inputTokens, e.output_tokens AS outputTokens,
  (SELECT GROUP_CONCAT(t.technology) FROM technologies t WHERE t.event_id = e.id) AS technologies`;

const FROM_CLAUSE = `
  FROM events e
  JOIN prompts p ON p.event_id = e.id
  JOIN providers pr ON pr.id = e.provider_id
  LEFT JOIN projects pj ON pj.id = e.project_id
  LEFT JOIN classifications c ON c.event_id = e.id`;

export class PromptRepository {
  constructor(private readonly connection: SqliteConnection) {}

  /**
   * G7: LIKE over a large corpus is unusable. Search goes through the FTS5 index; the
   * unfiltered listing keeps keyset pagination so deep pages stay cheap.
   */
  search(
    filters: EventFilters,
    options: { query?: string; limit: number; cursor?: string },
  ): { items: PromptListRow[]; nextCursor: string | null } {
    const where = buildEventWhere({ ...filters, eventType: 'prompt' });
    const params = [...where.params];
    const clauses = [where.sql];

    const trimmed = options.query?.trim();
    if (trimmed) {
      clauses.push('p.rowid IN (SELECT rowid FROM prompts_fts WHERE prompts_fts MATCH ?)');
      params.push(toMatchExpression(trimmed));
    }

    const cursor = decodeCursor(options.cursor);
    if (cursor) {
      clauses.push('(e.timestamp, e.id) < (?, ?)');
      params.push(cursor.timestamp, cursor.id);
    }

    const rows = this.connection
      .prepare(
        `SELECT ${SELECT_COLUMNS} ${FROM_CLAUSE}
         WHERE ${clauses.join(' AND ')}
         ORDER BY e.timestamp DESC, e.id DESC
         LIMIT ?`,
      )
      .all(...params, options.limit + 1) as PromptListRow[];

    const items = rows.slice(0, options.limit);
    const last = items[items.length - 1];
    const nextCursor =
      rows.length > options.limit && last
        ? encodeCursor({ timestamp: last.timestamp, id: last.id })
        : null;
    return { items, nextCursor };
  }

  detail(eventId: string): PromptDetailRow | undefined {
    return this.connection
      .prepare(
        `SELECT ${SELECT_COLUMNS},
                p.text,
                (SELECT r.text FROM responses r
                  JOIN events re ON re.id = r.event_id
                 WHERE re.session_id = e.session_id AND re.timestamp > e.timestamp
                 ORDER BY re.timestamp LIMIT 1) AS responseText,
                (SELECT GROUP_CONCAT(cx.context) FROM contexts cx WHERE cx.event_id = e.id) AS contexts,
                e.repository, e.git_branch AS gitBranch, e.working_directory AS workingDirectory,
                e.source_version AS sourceVersion, e.estimated_cost_usd AS estimatedCostUsd,
                e.cache_read_tokens AS cacheReadTokens, e.cache_write_tokens AS cacheWriteTokens
         ${FROM_CLAUSE}
         WHERE e.id = ?`,
      )
      .get(eventId) as PromptDetailRow | undefined;
  }

  repeated(
    filters: EventFilters,
    limit: number,
  ): Array<{ fingerprint: string; text: string | null; count: number; lastSeenAt: string }> {
    const where = buildEventWhere({ ...filters, eventType: 'prompt' });
    return this.connection
      .prepare(
        `SELECT p.normalized_hash AS fingerprint,
                MAX(p.preview) AS text,
                COUNT(*) AS count,
                MAX(e.timestamp) AS lastSeenAt
         FROM events e JOIN prompts p ON p.event_id = e.id
         WHERE ${where.sql} AND p.char_length > 12
         GROUP BY p.normalized_hash
         HAVING COUNT(*) > 1
         ORDER BY count DESC, lastSeenAt DESC
         LIMIT ?`,
      )
      .all(...where.params, limit) as Array<{
      fingerprint: string;
      text: string | null;
      count: number;
      lastSeenAt: string;
    }>;
  }

  lengthStats(filters: EventFilters): { avgChars: number; avgWords: number; total: number } {
    const where = buildEventWhere({ ...filters, eventType: 'prompt' });
    const row = this.connection
      .prepare(
        `SELECT COALESCE(AVG(p.char_length), 0) AS avgChars,
                COALESCE(AVG(p.word_length), 0) AS avgWords,
                COUNT(*) AS total
         FROM events e JOIN prompts p ON p.event_id = e.id
         WHERE ${where.sql}`,
      )
      .get(...where.params) as { avgChars: number; avgWords: number; total: number };
    return row;
  }

  textsForThemes(filters: EventFilters, limit: number): string[] {
    const where = buildEventWhere({ ...filters, eventType: 'prompt' });
    const rows = this.connection
      .prepare(
        `SELECT p.preview AS preview
         FROM events e JOIN prompts p ON p.event_id = e.id
         WHERE ${where.sql} AND p.preview IS NOT NULL
         ORDER BY e.timestamp DESC LIMIT ?`,
      )
      .all(...where.params, limit) as Array<{ preview: string }>;
    return rows.map((r) => r.preview);
  }

  rebuildIndex(): void {
    this.connection.prepare("INSERT INTO prompts_fts(prompts_fts) VALUES('rebuild')").run();
  }
}

/**
 * FTS5 treats bare punctuation as syntax. User input is split into bare tokens and quoted
 * so a query like `docker-compose "why?"` can never become a malformed MATCH expression.
 */
export function toMatchExpression(query: string): string {
  const tokens = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((token) => token.length > 0)
    .slice(0, 12);
  if (tokens.length === 0) return '""';
  return tokens.map((token) => `"${token}"*`).join(' ');
}
