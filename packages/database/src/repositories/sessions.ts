import { and, eq, isNull, sql } from 'drizzle-orm';
import type { AppDatabase, SqliteConnection } from '../client';
import { sessions } from '../schema';

export type SessionRecord = typeof sessions.$inferSelect;

export interface SessionUpsert {
  id: string;
  providerId: string;
  externalId: string | null;
  projectId: string | null;
  startedAt: string;
  endedAt: string | null;
  primaryModel: string | null;
  endReason: string | null;
}

export class SessionRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly connection: SqliteConnection,
  ) {}

  upsertMany(records: SessionUpsert[]): void {
    if (records.length === 0) return;
    const now = new Date().toISOString();
    this.db.transaction((tx) => {
      for (const record of records) {
        tx.insert(sessions)
          .values({ ...record, updatedAt: now })
          .onConflictDoUpdate({
            target: sessions.id,
            set: {
              projectId: sql`COALESCE(excluded.project_id, ${sessions.projectId})`,
              startedAt: sql`MIN(excluded.started_at, ${sessions.startedAt})`,
              endedAt: sql`MAX(COALESCE(excluded.ended_at, ''), COALESCE(${sessions.endedAt}, ''))`,
              primaryModel: sql`COALESCE(excluded.primary_model, ${sessions.primaryModel})`,
              endReason: sql`COALESCE(excluded.end_reason, ${sessions.endReason})`,
              updatedAt: now,
            },
          })
          .run();
      }
    });
  }

  findByExternalId(providerId: string, externalId: string): SessionRecord | undefined {
    return this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.providerId, providerId), eq(sessions.externalId, externalId)))
      .get();
  }

  /**
   * Session metrics are derived from the events that belong to them rather than stored as
   * the events arrive, so a partial backfill and a completed one produce the same numbers.
   * §6.4: idle gaps beyond the timeout do not count as usage.
   */
  recomputeMetrics(sessionIds: string[], idleTimeoutMs: number, tailAllowanceMs: number): void {
    if (sessionIds.length === 0) return;

    const aggregate = this.connection.prepare(`
      UPDATE sessions SET
        prompt_count = (SELECT COUNT(*) FROM events e WHERE e.session_id = sessions.id AND e.event_type = 'prompt'),
        response_count = (SELECT COUNT(*) FROM events e WHERE e.session_id = sessions.id AND e.event_type = 'response'),
        tool_count = (SELECT COUNT(*) FROM events e WHERE e.session_id = sessions.id AND e.event_type = 'tool_call'),
        input_tokens = (SELECT COALESCE(SUM(e.input_tokens), 0) FROM events e WHERE e.session_id = sessions.id),
        output_tokens = (SELECT COALESCE(SUM(e.output_tokens), 0) FROM events e WHERE e.session_id = sessions.id),
        cache_read_tokens = (SELECT COALESCE(SUM(e.cache_read_tokens), 0) FROM events e WHERE e.session_id = sessions.id),
        cache_write_tokens = (SELECT COALESCE(SUM(e.cache_write_tokens), 0) FROM events e WHERE e.session_id = sessions.id),
        estimated_cost_usd = (SELECT SUM(e.estimated_cost_usd) FROM events e WHERE e.session_id = sessions.id),
        started_at = COALESCE((SELECT MIN(e.timestamp) FROM events e WHERE e.session_id = sessions.id), started_at),
        ended_at = COALESCE((SELECT MAX(e.timestamp) FROM events e WHERE e.session_id = sessions.id), ended_at),
        project_id = COALESCE(project_id, (
          SELECT e.project_id FROM events e
          WHERE e.session_id = sessions.id AND e.project_id IS NOT NULL
          ORDER BY e.timestamp LIMIT 1
        )),
        primary_model = COALESCE((
          SELECT e.model FROM events e
          WHERE e.session_id = sessions.id AND e.model IS NOT NULL
          GROUP BY e.model ORDER BY COUNT(*) DESC LIMIT 1
        ), primary_model),
        updated_at = ?
      WHERE id = ?`);

    const activeTime = this.connection.prepare(`
      WITH ordered AS (
        SELECT timestamp,
               LAG(timestamp) OVER (ORDER BY timestamp) AS prev
        FROM events WHERE session_id = ?
      )
      SELECT COALESCE(SUM(
        MIN(
          MAX((julianday(timestamp) - julianday(prev)) * 86400000, 0),
          ?
        )
      ), 0) AS active
      FROM ordered WHERE prev IS NOT NULL`);

    const setDerived = this.connection.prepare(`
      UPDATE sessions
      SET active_ms = ?,
          duration_ms = CAST(
            MAX((julianday(COALESCE(ended_at, started_at)) - julianday(started_at)) * 86400000, 0)
            AS INTEGER)
      WHERE id = ?`);

    const eventCount = this.connection.prepare(
      'SELECT COUNT(*) AS n FROM events WHERE session_id = ?',
    );

    const now = new Date().toISOString();
    const run = this.connection.transaction((ids: string[]) => {
      for (const id of ids) {
        aggregate.run(now, id);
        const { n } = eventCount.get(id) as { n: number };
        const { active } = activeTime.get(id, idleTimeoutMs) as { active: number };
        const total = n > 0 ? Math.round(active) + tailAllowanceMs : 0;
        setDerived.run(total, id);
      }
    });
    run(sessionIds);
  }

  orphanedSessionIds(): string[] {
    return this.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(isNull(sessions.startedAt))
      .all()
      .map((r) => r.id);
  }

  count(): number {
    const row = this.connection.prepare('SELECT COUNT(*) AS n FROM sessions').get() as {
      n: number;
    };
    return row.n;
  }
}
