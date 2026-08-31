import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../src/store';
import { createTempStore, type TempStore } from './helpers';

function migrationIds(): string[] {
  return readdirSync(join(__dirname, '..', 'migrations'))
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => file.replace(/\.sql$/, ''));
}

let temp: TempStore | null = null;

afterEach(() => {
  temp?.cleanup();
  temp = null;
});

describe('migrations', () => {
  it('creates the database from nothing and passes an integrity check', () => {
    temp = createTempStore();
    expect(existsSync(temp.store.databasePath)).toBe(true);
    // Derived from the directory rather than hard-coded, so adding a migration does not mean
    // editing this assertion, and a migration that fails to apply still fails the test.
    expect(temp.store.migration.applied).toEqual(migrationIds());
    expect(temp.store.integrity()).toBe('ok');
  });

  it('creates every declared table', () => {
    temp = createTempStore();
    const rows = temp.store.connection
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = new Set(rows.map((r) => r.name));
    for (const table of [
      'providers',
      'sessions',
      'events',
      'prompts',
      'responses',
      'projects',
      'tool_calls',
      'classifications',
      'technologies',
      'contexts',
      'daily_rollups',
      'collector_state',
      'ingest_log',
      'settings',
      'schema_meta',
      'prompts_fts',
    ]) {
      expect(names.has(table), `missing table ${table}`).toBe(true);
    }
  });

  it('is a no-op on a second run and takes no backup when nothing is pending', () => {
    temp = createTempStore();
    const path = temp.store.databasePath;
    const backupDir = join(temp.dir, 'backups');
    temp.store.close();

    const reopened = new Store({
      databasePath: path,
      paths: {
        root: temp.dir,
        data: temp.dir,
        database: path,
        logs: temp.dir,
        cache: temp.dir,
        config: temp.dir,
        backups: backupDir,
        runtimeConfig: join(temp.dir, 'runtime.json'),
      },
    });
    expect(reopened.migration.applied).toEqual([]);
    expect(reopened.migration.alreadyApplied).toBe(migrationIds().length);
    expect(reopened.migration.backupPath).toBeNull();
    expect(existsSync(backupDir) ? readdirSync(backupDir) : []).toHaveLength(0);
    reopened.close();
    temp.store.close = () => {};
  });

  it('refuses to run when an applied migration has been altered', () => {
    temp = createTempStore();
    temp.store.connection
      .prepare("UPDATE _migrations SET hash = 'tampered' WHERE id = '0001_initial'")
      .run();
    const path = temp.store.databasePath;
    const dir = temp.dir;
    temp.store.close();
    expect(
      () =>
        new Store({
          databasePath: path,
          paths: {
            root: dir,
            data: dir,
            database: path,
            logs: dir,
            cache: dir,
            config: dir,
            backups: join(dir, 'backups'),
            runtimeConfig: join(dir, 'runtime.json'),
          },
        }),
    ).toThrow(/changed after it was applied/);
    temp.store.close = () => {};
  });
});
