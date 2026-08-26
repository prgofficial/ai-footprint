import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type SqliteConnection = Database.Database;
export type AppDatabase = BetterSQLite3Database<typeof schema> & { $client: SqliteConnection };

export interface OpenDatabaseOptions {
  path: string;
  readonly?: boolean;
  /** WAL is unsafe on virtualised bind mounts; the Docker entrypoint turns it off. */
  journalMode?: 'WAL' | 'DELETE' | 'TRUNCATE';
}

export function openSqlite(options: OpenDatabaseOptions): SqliteConnection {
  if (options.path !== ':memory:') {
    mkdirSync(dirname(options.path), { recursive: true });
  }
  const connection = new Database(options.path, { readonly: options.readonly ?? false });

  connection.pragma(`journal_mode = ${options.journalMode ?? 'WAL'}`);
  connection.pragma('synchronous = NORMAL');
  connection.pragma('foreign_keys = ON');
  connection.pragma('busy_timeout = 5000');
  connection.pragma('cache_size = -64000');
  connection.pragma('temp_store = MEMORY');
  try {
    connection.pragma('mmap_size = 268435456');
  } catch {
    // mmap is unavailable on some filesystems; the database works without it.
  }
  return connection;
}

export function createDatabase(connection: SqliteConnection): AppDatabase {
  return drizzle(connection, { schema }) as AppDatabase;
}

export function integrityCheck(connection: SqliteConnection): 'ok' | 'failed' {
  try {
    const rows = connection.pragma('integrity_check') as Array<{ integrity_check: string }>;
    return rows[0]?.integrity_check === 'ok' ? 'ok' : 'failed';
  } catch {
    return 'failed';
  }
}

export function checkpointAndClose(connection: SqliteConnection): void {
  try {
    if (connection.open) {
      const mode = connection.pragma('journal_mode', { simple: true });
      if (mode === 'wal') connection.pragma('wal_checkpoint(TRUNCATE)');
    }
  } catch {
    // A failed checkpoint must not prevent a clean shutdown; WAL replays on next open.
  }
  try {
    if (connection.open) connection.close();
  } catch {
    // Already closed.
  }
}
