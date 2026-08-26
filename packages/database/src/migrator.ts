import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import type { SqliteConnection } from './client';

export interface MigrationFile {
  id: string;
  hash: string;
  sql: string;
}

export interface MigrateOptions {
  backupDir?: string;
  databasePath?: string;
  keepBackups?: number;
  migrationsDir?: string;
  onEvent?: (event: { kind: 'backup' | 'apply' | 'skip'; id?: string; file?: string }) => void;
}

export interface MigrateResult {
  applied: string[];
  alreadyApplied: number;
  backupPath: string | null;
}

const CANDIDATE_DIRS = ['../migrations', '../../migrations', './migrations'];

export function resolveMigrationsDir(explicit?: string): string {
  if (explicit) return resolve(explicit);
  for (const candidate of CANDIDATE_DIRS) {
    const dir = resolve(__dirname, candidate);
    if (existsSync(join(dir, '0001_initial.sql'))) return dir;
  }
  throw new Error('Migrations directory not found');
}

export function loadMigrations(dir: string): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => {
      const sql = readFileSync(join(dir, file), 'utf8');
      return {
        id: file.replace(/\.sql$/, ''),
        hash: createHash('sha256').update(sql).digest('hex'),
        sql,
      };
    });
}

function ensureMigrationsTable(connection: SqliteConnection): void {
  connection.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
       id TEXT PRIMARY KEY NOT NULL,
       hash TEXT NOT NULL,
       applied_at TEXT NOT NULL
     )`,
  );
}

/**
 * G6: a bad migration would destroy irreplaceable local history, so the database is copied
 * before anything is applied. Skipped when there is nothing pending.
 */
function backupDatabase(options: MigrateOptions): string | null {
  const { databasePath, backupDir } = options;
  if (!databasePath || !backupDir) return null;
  if (!existsSync(databasePath) || statSync(databasePath).size === 0) return null;

  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = join(backupDir, `app-${stamp}.db`);
  copyFileSync(databasePath, target);

  const keep = options.keepBackups ?? 5;
  const existing = readdirSync(backupDir)
    .filter((f) => f.startsWith('app-') && f.endsWith('.db'))
    .sort()
    .reverse();
  for (const stale of existing.slice(keep)) {
    try {
      unlinkSync(join(backupDir, stale));
    } catch {
      // A backup we cannot delete is not a reason to fail startup.
    }
  }
  return target;
}

export function migrate(connection: SqliteConnection, options: MigrateOptions = {}): MigrateResult {
  const dir = resolveMigrationsDir(options.migrationsDir);
  const files = loadMigrations(dir);
  ensureMigrationsTable(connection);

  const appliedRows = connection.prepare('SELECT id, hash FROM _migrations').all() as Array<{
    id: string;
    hash: string;
  }>;
  const appliedById = new Map(appliedRows.map((r) => [r.id, r.hash]));

  for (const file of files) {
    const knownHash = appliedById.get(file.id);
    if (knownHash && knownHash !== file.hash) {
      throw new Error(
        `Migration ${file.id} changed after it was applied. Restore a backup or reinstall.`,
      );
    }
  }

  const pending = files.filter((f) => !appliedById.has(f.id));
  if (pending.length === 0) {
    options.onEvent?.({ kind: 'skip' });
    return { applied: [], alreadyApplied: appliedById.size, backupPath: null };
  }

  // Nothing to protect on a first-run database: the backup exists to survive a bad
  // migration against data that already matters.
  const backupPath = appliedById.size > 0 ? backupDatabase(options) : null;
  if (backupPath) options.onEvent?.({ kind: 'backup', file: backupPath });

  const insert = connection.prepare(
    'INSERT INTO _migrations (id, hash, applied_at) VALUES (?, ?, ?)',
  );

  for (const file of pending) {
    const run = connection.transaction(() => {
      connection.exec(file.sql);
      insert.run(file.id, file.hash, new Date().toISOString());
    });
    run();
    options.onEvent?.({ kind: 'apply', id: file.id });
  }

  return { applied: pending.map((f) => f.id), alreadyApplied: appliedById.size, backupPath };
}

export function listBackups(
  backupDir: string,
): Array<{ file: string; sizeBytes: number; createdAt: string }> {
  if (!existsSync(backupDir)) return [];
  return readdirSync(backupDir)
    .filter((f) => f.endsWith('.db'))
    .map((file) => {
      const stats = statSync(join(backupDir, file));
      return { file, sizeBytes: stats.size, createdAt: stats.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
