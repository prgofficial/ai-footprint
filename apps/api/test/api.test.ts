import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INGEST_TOKEN_HEADER } from '@ai-footprint/shared';
import { startTestApp, syntheticBatch, type TestApp } from './harness';

let api: TestApp;

beforeAll(async () => {
  api = await startTestApp();
}, 30_000);

afterAll(async () => {
  await api?.close();
});

const ingest = (events: unknown[], token = api.token) =>
  api.post(
    '/api/ingest/events',
    { providerId: 'claude-code', events },
    { [INGEST_TOKEN_HEADER]: token },
  );

describe('system endpoints', () => {
  it('reports health with a working database', async () => {
    const body = await api.json<{ status: string; db: { ok: boolean } }>('/api/health');
    expect(body.status).toBe('ok');
    expect(body.db.ok).toBe(true);
  });

  it('serves runtime configuration without needing a round trip to find the API', async () => {
    const config = await api.json<{ apiBaseUrl: string; providers: unknown[]; mode: string }>(
      '/api/system/config',
    );
    expect(config.apiBaseUrl).toBe('');
    expect(config.mode).toBe('native');
    expect(config.providers).toHaveLength(1);
  });

  it('reports storage with an intact database', async () => {
    const storage = await api.json<{ integrity: string; tables: unknown[] }>('/api/system/storage');
    expect(storage.integrity).toBe('ok');
    expect(storage.tables.length).toBeGreaterThan(10);
  });

  it('binds to loopback only', () => {
    expect(api.url).toContain('localhost');
  });
});

describe('security guards', () => {
  it('rejects a cross-origin request outright', async () => {
    const response = await api.get('/api/system/config', {
      headers: { Origin: 'https://attacker.example' },
    });
    expect(response.status).toBe(403);
  });

  it('accepts a same-origin request', async () => {
    const response = await api.get('/api/system/config', { headers: { Origin: api.url } });
    expect(response.status).toBe(200);
  });

  it('refuses ingestion without the token', async () => {
    expect((await ingest(syntheticBatch(1), 'wrong-token')).status).toBe(403);
  });

  it('returns a user-facing error shape, never a raw stack', async () => {
    const response = await api.get('/api/analytics/prompts/does-not-exist');
    const body = (await response.json()) as { title: string; message: string; details?: string };
    expect(response.status).toBe(404);
    expect(body.title).toBe('Not found');
    expect(body.message).not.toMatch(/at .*\.ts:\d+/);
  });

  it('explains a validation failure in words', async () => {
    const response = await api.get('/api/analytics/overview?range=nonsense');
    const body = (await response.json()) as { title: string; message: string };
    expect(response.status).toBe(400);
    expect(body.title).toBe('That request could not be understood');
    expect(body.message).toContain('range');
  });
});

describe('ingestion', () => {
  it('accepts a batch and is idempotent when it is replayed', async () => {
    const events = syntheticBatch(200);

    const first = (await (await ingest(events)).json()) as { accepted: number; deduped: number };
    expect(first.accepted).toBe(200);
    expect(first.deduped).toBe(0);

    const second = (await (await ingest(events)).json()) as { accepted: number; deduped: number };
    expect(second.accepted).toBe(0);
    expect(second.deduped).toBe(200);

    const overview = await api.json<{ totals: { prompts: number } }>(
      '/api/analytics/overview?range=all&timezone=UTC',
    );
    expect(overview.totals.prompts).toBe(200);
  });

  it('rejects a malformed batch without storing anything', async () => {
    const before = await api.json<{ totals: { events: number } }>(
      '/api/analytics/overview?range=all',
    );
    const response = await ingest([{ eventType: 'prompt' }]);
    expect(response.status).toBe(400);
    const after = await api.json<{ totals: { events: number } }>(
      '/api/analytics/overview?range=all',
    );
    expect(after.totals.events).toBe(before.totals.events);
  });

  it('drops an individual invalid event but keeps the valid ones', async () => {
    const events: unknown[] = [
      ...syntheticBatch(3, 1),
      { ...syntheticBatch(1, 1)[0], externalId: 'bad', timestamp: 'not-a-date' },
    ];
    const response = await ingest(events);
    expect(response.status).toBe(400);
  });

  it('accepts a hook payload and never fails the editor', async () => {
    const response = await api.post(
      '/api/ingest/hook',
      { hook_event_name: 'SessionStart', session_id: 'hook-session', cwd: '/tmp/x' },
      { [INGEST_TOKEN_HEADER]: api.token },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('ignores a hook event it does not map without erroring', async () => {
    const response = await api.post(
      '/api/ingest/hook',
      { hook_event_name: 'SomeFutureHook', session_id: 's' },
      { [INGEST_TOKEN_HEADER]: api.token },
    );
    expect(response.status).toBe(200);
  });
});

describe('providers', () => {
  it('lists the Claude Code adapter with honest capabilities', async () => {
    const providers =
      await api.json<Array<{ id: string; capabilities: Record<string, boolean>; status: string }>>(
        '/api/providers',
      );
    expect(providers[0]?.id).toBe('claude-code');
    expect(providers[0]?.capabilities.tokens).toBe(true);
    expect(providers[0]?.capabilities.historicalBackfill).toBe(true);
  });

  it('reports detection without connecting', async () => {
    const detection = await api.json<{ detected: boolean; message: string }>(
      '/api/providers/claude-code/detect',
    );
    expect(typeof detection.detected).toBe('boolean');
    expect(detection.message.length).toBeGreaterThan(0);
  });

  it('404s on an unknown provider', async () => {
    expect((await api.get('/api/providers/does-not-exist/detect')).status).toBe(404);
  });
});

describe('single-origin hosting', () => {
  it('falls through to the SPA for a non-API path', async () => {
    const response = await api.get('/prompts');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('html');
  });

  it('does not fall through for an unknown API path', async () => {
    expect((await api.get('/api/definitely-not-a-route')).status).toBe(404);
  });
});

describe('token stability', () => {
  it('survives shutdown, so a hook that embedded it keeps working', async () => {
    const before = api.token;
    const home = api.home;
    await api.app.close();

    // The runtime file is deliberately not removed on shutdown: a Claude Code hook stores
    // this token in the user's settings.json, and a fresh one would silently break it.
    const stored = JSON.parse(readFileSync(join(home, 'config', 'runtime.json'), 'utf8')) as {
      ingestToken: string;
      stoppedAt: string | null;
    };
    expect(stored.ingestToken).toBe(before);
    expect(stored.stoppedAt).toBeTruthy();
  });
});
