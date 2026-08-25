import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertPathInside, getAppPaths, isPathInside, resolveAppRoot } from './paths';

describe('resolveAppRoot', () => {
  it('honours an explicit override', () => {
    const root = resolveAppRoot({ AI_FOOTPRINT_HOME: join(tmpdir(), 'af-test') });
    expect(root).toBe(join(tmpdir(), 'af-test'));
  });

  it('never points inside the repository', () => {
    const root = resolveAppRoot({});
    expect(root.includes(`${'ai'}-footprint${'/'}packages`)).toBe(false);
  });
});

describe('getAppPaths', () => {
  it('derives every directory from the root', () => {
    const base = join(tmpdir(), 'af-paths');
    const paths = getAppPaths({ AI_FOOTPRINT_HOME: base });
    expect(paths.database).toBe(join(base, 'data', 'app.db'));
    expect(paths.runtimeConfig).toBe(join(base, 'config', 'runtime.json'));
    expect(paths.backups).toBe(join(base, 'backups'));
  });
});

describe('isPathInside', () => {
  const parent = join(tmpdir(), 'af-root');

  it('accepts descendants and the root itself', () => {
    expect(isPathInside(join(parent, 'a', 'b.jsonl'), parent)).toBe(true);
    expect(isPathInside(parent, parent)).toBe(true);
  });

  it('rejects traversal and sibling prefixes', () => {
    expect(isPathInside(join(parent, '..', 'elsewhere'), parent)).toBe(false);
    expect(isPathInside(`${parent}-sibling`, parent)).toBe(false);
    expect(() => assertPathInside(join(parent, '..', 'etc', 'passwd'), parent)).toThrow();
  });
});
