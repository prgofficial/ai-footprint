import { existsSync, statSync } from 'node:fs';
import type { SqliteConnection } from '../client';

const COUNTED_TABLES = [
  'events',
  'prompts',
  'responses',
  'sessions',
  'projects',
  'tool_calls',
  'classifications',
  'technologies',
  'contexts',
  'daily_rollups',
  'collector_state',
  'ingest_log',
  'providers',
  'settings',
] as const;

export interface DeleteScope {
  scope: 'all' | 'prompts' | 'provider' | 'project' | 'range';
  providerId?: string;
  projectId?: string;
  from?: string;
  to?: string;
}

export interface DeleteCounts {
  events: number;
  prompts: number;
  sessions: number;
  projects: number;
}

export class MaintenanceRepository {
  constructor(private readonly connection: SqliteConnection) {}

  tableCounts(): Array<{ table: string; rows: number }> {
    return COUNTED_TABLES.map((table) => {
      const row = this.connection.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
        n: number;
      };
      return { table, rows: row.n };
    });
  }

  databaseSize(path: string): { db: number; wal: number } {
    const size = (p: string) => (existsSync(p) ? statSync(p).size : 0);
    return { db: size(path), wal: size(`${path}-wal`) };
  }

  private eventFilter(scope: DeleteScope): { where: string; params: unknown[] } {
    switch (scope.scope) {
      case 'provider':
        return { where: 'provider_id = ?', params: [scope.providerId] };
      case 'project':
        return { where: 'project_id = ?', params: [scope.projectId] };
      case 'range':
        return { where: 'timestamp >= ? AND timestamp <= ?', params: [scope.from, scope.to] };
      default:
        return { where: '1 = 1', params: [] };
    }
  }

  preview(scope: DeleteScope): DeleteCounts {
    if (scope.scope === 'prompts') {
      const prompts = this.connection.prepare('SELECT COUNT(*) AS n FROM prompts').get() as {
        n: number;
      };
      return { events: 0, prompts: prompts.n, sessions: 0, projects: 0 };
    }
    const { where, params } = this.eventFilter(scope);
    const events = this.connection
      .prepare(`SELECT COUNT(*) AS n FROM events WHERE ${where}`)
      .get(...params) as { n: number };
    const prompts = this.connection
      .prepare(
        `SELECT COUNT(*) AS n FROM prompts WHERE event_id IN (SELECT id FROM events WHERE ${where})`,
      )
      .get(...params) as { n: number };
    const sessions = this.connection
      .prepare(
        `SELECT COUNT(DISTINCT session_id) AS n FROM events WHERE session_id IS NOT NULL AND ${where}`,
      )
      .get(...params) as { n: number };
    const projects = this.connection
      .prepare(
        `SELECT COUNT(DISTINCT project_id) AS n FROM events WHERE project_id IS NOT NULL AND ${where}`,
      )
      .get(...params) as { n: number };
    return { events: events.n, prompts: prompts.n, sessions: sessions.n, projects: projects.n };
  }

  /** Prompt text lives in its own table so deleting it leaves every analytic intact. */
  execute(scope: DeleteScope): DeleteCounts {
    const counts = this.preview(scope);

    const run = this.connection.transaction(() => {
      if (scope.scope === 'prompts') {
        this.connection.prepare('UPDATE prompts SET text = NULL, preview = NULL').run();
        this.connection.prepare('DELETE FROM responses').run();
        this.connection.prepare("INSERT INTO prompts_fts(prompts_fts) VALUES('rebuild')").run();
        return;
      }

      if (scope.scope === 'all') {
        for (const table of [
          'technologies',
          'contexts',
          'classifications',
          'tool_calls',
          'responses',
          'prompts',
          'events',
          'sessions',
          'projects',
          'daily_rollups',
          'collector_state',
          'ingest_log',
        ]) {
          this.connection.prepare(`DELETE FROM ${table}`).run();
        }
        this.connection.prepare("INSERT INTO prompts_fts(prompts_fts) VALUES('rebuild')").run();
        return;
      }

      const { where, params } = this.eventFilter(scope);
      this.connection.prepare(`DELETE FROM events WHERE ${where}`).run(...params);
      this.connection
        .prepare(
          'DELETE FROM sessions WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.session_id = sessions.id)',
        )
        .run();
      this.connection
        .prepare(
          'DELETE FROM projects WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.project_id = projects.id)',
        )
        .run();
      this.connection.prepare('DELETE FROM daily_rollups').run();
      if (scope.scope === 'provider' && scope.providerId) {
        this.connection
          .prepare('DELETE FROM collector_state WHERE provider_id = ?')
          .run(scope.providerId);
      }
    });
    run();

    return counts;
  }

  vacuum(): void {
    this.connection.prepare('VACUUM').run();
  }

  applyRetention(months: number): number {
    if (months <= 0) return 0;
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const iso = cutoff.toISOString();
    const result = this.connection
      .prepare(
        `UPDATE prompts SET text = NULL, preview = NULL
         WHERE text IS NOT NULL
           AND event_id IN (SELECT id FROM events WHERE timestamp < ?)`,
      )
      .run(iso);
    if (result.changes > 0) {
      this.connection.prepare("INSERT INTO prompts_fts(prompts_fts) VALUES('rebuild')").run();
    }
    return result.changes;
  }
}
