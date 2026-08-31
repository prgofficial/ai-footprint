import type { SqliteConnection } from '../client';

/**
 * G8: recomputing analytics from raw events on every page load will not survive years of
 * history. Only the (day, provider) pairs an ingest touched are recomputed, and long
 * ranges then read these tables instead of the event log.
 */
const REBUILD_DAY = `
INSERT INTO daily_rollups (
  day, provider_id, project_id, model, category,
  prompts, responses, tool_calls, other_events, sessions,
  input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
  estimated_cost_usd, confidence_sum
)
SELECT
  e.local_date,
  e.provider_id,
  COALESCE(e.project_id, ''),
  COALESCE(e.model, ''),
  COALESCE(c.category, ''),
  SUM(CASE WHEN e.event_type = 'prompt' THEN 1 ELSE 0 END),
  SUM(CASE WHEN e.event_type = 'response' THEN 1 ELSE 0 END),
  SUM(CASE WHEN e.event_type = 'tool_call' THEN 1 ELSE 0 END),
  -- Everything else the event contract allows, so the rollup total equals COUNT(*).
  SUM(CASE WHEN e.event_type NOT IN ('prompt','response','tool_call') THEN 1 ELSE 0 END),
  COUNT(DISTINCT e.session_id),
  COALESCE(SUM(e.input_tokens), 0),
  COALESCE(SUM(e.output_tokens), 0),
  COALESCE(SUM(e.cache_read_tokens), 0),
  COALESCE(SUM(e.cache_write_tokens), 0),
  -- Deliberately not COALESCEd: a group with no priced model must stay null, or every range
  -- longer than a week reports $0.00 where the event log reports "unknown".
  SUM(e.estimated_cost_usd),
  COALESCE(SUM(c.confidence), 0)
FROM events e
LEFT JOIN classifications c ON c.event_id = e.id
WHERE e.local_date = ? AND e.provider_id = ?
GROUP BY e.local_date, e.provider_id, COALESCE(e.project_id, ''), COALESCE(e.model, ''), COALESCE(c.category, '')`;

/** Active time per (session, local day), same clamped-gap rule as §6.4, so day sums match. */
/**
 * Partitioned by session alone, each gap charged to the local day of its LATER event, so the
 * gap across midnight is measured rather than dropped. The scan is not limited to the rebuilt
 * day: the predecessor of its first event usually sits on the day before.
 */
const REBUILD_ACTIVE = `
INSERT INTO daily_active (day, provider_id, active_ms, sessions)
SELECT day, provider_id,
       CAST(COALESCE(SUM(CASE WHEN prev IS NULL THEN 0
              ELSE MIN(MAX((julianday(ts) - julianday(prev)) * 86400000, 0), ?) END), 0)
            AS INTEGER) + COUNT(DISTINCT sid) * ?,
       COUNT(DISTINCT sid)
FROM (
  SELECT e.local_date AS day, e.provider_id AS provider_id, e.session_id AS sid, e.timestamp AS ts,
         LAG(e.timestamp) OVER (PARTITION BY e.session_id ORDER BY e.timestamp) AS prev
  FROM events e
  WHERE e.provider_id = ? AND e.session_id IS NOT NULL
    AND e.session_id IN (SELECT DISTINCT session_id FROM events
                          WHERE local_date = ? AND provider_id = ? AND session_id IS NOT NULL)
)
WHERE day = ?
GROUP BY day, provider_id`;

export interface RollupDay {
  day: string;
  providerId: string;
}

export class RollupRepository {
  private readonly deleteDay;
  private readonly deleteActive;
  private readonly rebuildDay;
  private readonly rebuildActive;

  constructor(private readonly connection: SqliteConnection) {
    this.deleteDay = connection.prepare(
      'DELETE FROM daily_rollups WHERE day = ? AND provider_id = ?',
    );
    this.deleteActive = connection.prepare(
      'DELETE FROM daily_active WHERE day = ? AND provider_id = ?',
    );
    this.rebuildDay = connection.prepare(REBUILD_DAY);
    this.rebuildActive = connection.prepare(REBUILD_ACTIVE);
  }

  rebuild(days: RollupDay[], idleTimeoutMs = 300_000, tailAllowanceMs = 60_000): void {
    if (days.length === 0) return;
    const run = this.connection.transaction((batch: RollupDay[]) => {
      for (const { day, providerId } of batch) {
        this.deleteDay.run(day, providerId);
        this.rebuildDay.run(day, providerId);
        this.deleteActive.run(day, providerId);
        this.rebuildActive.run(idleTimeoutMs, tailAllowanceMs, providerId, day, providerId, day);
      }
    });
    run(days);
  }

  rebuildAll(idleTimeoutMs = 300_000, tailAllowanceMs = 60_000): number {
    const pairs = this.connection
      .prepare('SELECT DISTINCT local_date AS day, provider_id AS providerId FROM events')
      .all() as RollupDay[];
    this.rebuild(pairs, idleTimeoutMs, tailAllowanceMs);
    return pairs.length;
  }

  clear(): void {
    this.connection.prepare('DELETE FROM daily_rollups').run();
    this.connection.prepare('DELETE FROM daily_active').run();
  }

  /**
   * True when the event log holds data the derived tables do not describe, which is what a
   * migration that invalidates them leaves behind. Every event contributes a rollup row, so
   * events with no rollups at all can only mean the tables need rebuilding.
   */
  needsRebuild(): boolean {
    const row = this.connection
      .prepare(
        `SELECT EXISTS(SELECT 1 FROM events) AS hasEvents,
                EXISTS(SELECT 1 FROM daily_rollups) AS hasRollups`,
      )
      .get() as { hasEvents: number; hasRollups: number };
    return row.hasEvents === 1 && row.hasRollups === 0;
  }

  coveredDays(): number {
    const row = this.connection.prepare('SELECT COUNT(*) AS n FROM daily_active').get() as {
      n: number;
    };
    return row.n;
  }
}
