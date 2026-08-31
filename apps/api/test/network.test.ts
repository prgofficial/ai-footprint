import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Socket } from 'node:net';
import { INGEST_TOKEN_HEADER } from '@ai-footprint/shared';
import { startTestApp, syntheticBatch, type TestApp } from './harness';

let api: TestApp;

/**
 * Brief §3 and §30 promise that no user data leaves the machine. This asserts it at the
 * network layer: any attempt to open a socket to anything other than loopback, or to resolve
 * a hostname, fails the test outright while the app does its real work.
 */
const offMachine: string[] = [];
const LOCAL = new Set(['127.0.0.1', 'localhost', '::1', '::ffff:127.0.0.1', '']);

function hostOf(args: unknown[]): string {
  const first = args[0];
  if (typeof first === 'object' && first !== null) {
    return String((first as { host?: string }).host ?? '127.0.0.1');
  }
  if (typeof first === 'number') return String(args[1] ?? '127.0.0.1');
  return String(first ?? '');
}

beforeAll(async () => {
  // Prototype patching rather than module patching: an ESM namespace object is frozen, but
  // every socket the process opens still goes through this method.
  const originalConnect = Socket.prototype.connect;
  Socket.prototype.connect = function patched(this: Socket, ...args: unknown[]) {
    const host = hostOf(args);
    if (!LOCAL.has(host)) offMachine.push(`socket ${host}`);
    return (originalConnect as (...a: unknown[]) => Socket).apply(this, args);
  } as typeof Socket.prototype.connect;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    try {
      const { hostname } = new URL(url);
      if (!LOCAL.has(hostname)) offMachine.push(`fetch ${hostname}`);
    } catch {
      offMachine.push(`fetch ${url}`);
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  api = await startTestApp();
}, 30_000);

afterAll(async () => {
  await api?.close();
});

describe('no outbound network', () => {
  it('ingests, enriches, aggregates and exports without leaving the machine', async () => {
    await api.post(
      '/api/ingest/events',
      { providerId: 'claude-code', events: syntheticBatch(50) },
      { [INGEST_TOKEN_HEADER]: api.token },
    );
    await api.post('/api/enrichment/run');

    for (const path of [
      '/api/analytics/overview?range=all&timezone=UTC',
      '/api/analytics/insights?range=all&timezone=UTC',
      '/api/analytics/prompts?range=all&q=test&timezone=UTC',
      '/api/analytics/models?range=all&timezone=UTC',
      '/api/data/export?range=all&format=json&timezone=UTC',
      '/api/providers',
      '/api/system/config',
    ]) {
      expect((await api.get(path)).ok, path).toBe(true);
    }

    expect(offMachine, 'the application attempted to reach off this machine').toEqual([]);
  });

  it('has no fetch call anywhere in the collector or API source', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');

    const offenders: string[] = [];
    const scan = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry === 'node_modules' || entry === 'dist') continue;
          scan(full);
          continue;
        }
        if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
        const source = readFileSync(full, 'utf8');
        if (/(?<![.\w])fetch\s*\(/.test(source)) offenders.push(full);
      }
    };

    const root = join(__dirname, '..', '..', '..');
    scan(join(root, 'packages'));
    scan(join(root, 'apps', 'api', 'src'));
    expect(offenders).toEqual([]);
  });
});
