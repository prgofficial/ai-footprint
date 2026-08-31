// hygiene:allow-secret-fixtures: these are published example credentials used to
// prove the redactor removes them. They grant no access to anything.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INGEST_TOKEN_HEADER } from '@ai-footprint/shared';
import { startTestApp, type TestApp } from './harness';

let api: TestApp;

const DAY = 86_400_000;
const ANCHOR = Date.now() - 2 * 3_600_000;

function seed(count: number, project: string, daysAgo: number) {
  const day = ANCHOR - daysAgo * DAY;
  return Array.from({ length: count }, (_, i) => [
    {
      externalId: `${project}-${daysAgo}-p${i}`,
      eventType: 'prompt',
      timestamp: new Date(day - i * 60_000).toISOString(),
      sessionId: `${project}-${daysAgo}`,
      prompt: `implement feature ${i} with a leaked key AKIAIOSFODNN7EXAMPLE`,
      workingDirectory: `/tmp/af-data/${project}`,
      tzOffsetMinutes: 0,
    },
    {
      externalId: `${project}-${daysAgo}-r${i}`,
      eventType: 'response',
      timestamp: new Date(day - i * 60_000 + 10_000).toISOString(),
      sessionId: `${project}-${daysAgo}`,
      model: 'claude-opus-4-8',
      inputTokens: 10,
      outputTokens: 5,
      workingDirectory: `/tmp/af-data/${project}`,
      tzOffsetMinutes: 0,
    },
  ]).flat();
}

const ingest = (events: unknown[]) =>
  api.post(
    '/api/ingest/events',
    { providerId: 'claude-code', events },
    { [INGEST_TOKEN_HEADER]: api.token },
  );

beforeAll(async () => {
  api = await startTestApp();
  await ingest([...seed(5, 'alpha', 0), ...seed(3, 'beta', 1)]);
  await api.post('/api/enrichment/run');
}, 60_000);

afterAll(async () => {
  await api?.close();
});

describe('privacy', () => {
  it('redacts credentials before they reach the database', async () => {
    const list = await api.json<{ items: Array<{ id: string; redactionCount: number }> }>(
      '/api/analytics/prompts?range=all&limit=1&timezone=UTC',
    );
    const first = list.items[0];
    expect(first?.redactionCount).toBe(1);

    const detail = await api.json<{ text: string }>(`/api/analytics/prompts/${first?.id}`);
    expect(detail.text).toContain('[redacted:aws_access_key]');
    expect(detail.text).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('exposes where the data lives', async () => {
    const config = await api.json<{ dataDirectory: string; databasePath: string }>(
      '/api/system/config',
    );
    expect(config.databasePath).toContain('app.db');
    expect(config.databasePath.startsWith(config.dataDirectory)).toBe(true);
  });
});

describe('export', () => {
  it('streams JSON with a manifest and every event', async () => {
    const response = await api.get('/api/data/export?range=all&format=json&timezone=UTC');
    expect(response.headers.get('content-disposition')).toContain('attachment');
    const body = (await response.json()) as {
      manifest: { formatVersion: number; rowCounts: unknown[] };
      events: Array<{ id: string; eventType: string }>;
    };
    expect(body.manifest.formatVersion).toBe(1);
    expect(body.events).toHaveLength(16);
    expect(body.events.filter((e) => e.eventType === 'prompt')).toHaveLength(8);
  });

  it('streams CSV with a header row per event', async () => {
    const text = await (await api.get('/api/data/export?range=all&format=csv&timezone=UTC')).text();
    const lines = text.trim().split('\n');
    expect(lines[0]).toContain('id,timestamp');
    expect(lines).toHaveLength(17);
  });

  it('quotes CSV values that contain a comma or a newline', async () => {
    const text = await (await api.get('/api/data/export?range=all&format=csv&timezone=UTC')).text();
    expect(text).not.toMatch(/\n[^"\n]*,[^"\n]*\n\n/);
  });

  it('omits prompt text when asked to', async () => {
    const body = (await (
      await api.get('/api/data/export?range=all&format=json&includePrompts=false&timezone=UTC')
    ).json()) as { events: Array<{ promptText: string | null }> };
    expect(body.events.every((e) => e.promptText === null)).toBe(true);
  });
});

describe('deletion', () => {
  it('previews exactly what a scoped delete would remove', async () => {
    const projects = await api.json<Array<{ projectId: string; name: string }>>(
      '/api/analytics/projects?range=all&timezone=UTC',
    );
    const beta = projects.find((p) => p.name === 'beta');
    const preview = (await (
      await api.post('/api/data/delete/preview', { scope: 'project', projectId: beta?.projectId })
    ).json()) as { events: number; prompts: number };
    expect(preview.events).toBe(6);
    expect(preview.prompts).toBe(3);
  });

  it('refuses to delete without the typed confirmation', async () => {
    const response = await api.post('/api/data/delete', { scope: 'all' });
    expect(response.status).toBe(400);
    const overview = await api.json<{ totals: { events: number } }>(
      '/api/analytics/overview?range=all&timezone=UTC',
    );
    expect(overview.totals.events).toBe(16);
  });

  it('deletes prompt text while leaving analytics intact', async () => {
    const before = await api.json<{ totals: { prompts: number; events: number } }>(
      '/api/analytics/overview?range=all&timezone=UTC',
    );
    await api.post('/api/data/delete', { scope: 'prompts', confirm: 'DELETE' });

    const after = await api.json<{ totals: { prompts: number; events: number } }>(
      '/api/analytics/overview?range=all&timezone=UTC',
    );
    expect(after.totals.prompts).toBe(before.totals.prompts);
    expect(after.totals.events).toBe(before.totals.events);

    const list = await api.json<{ items: Array<{ id: string }> }>(
      '/api/analytics/prompts?range=all&limit=1&timezone=UTC',
    );
    const detail = await api.json<{ text: string | null; textAvailable: boolean }>(
      `/api/analytics/prompts/${list.items[0]?.id}`,
    );
    expect(detail.text).toBeNull();
    expect(detail.textAvailable).toBe(false);

    const search = await api.json<{ items: unknown[] }>(
      '/api/analytics/prompts?range=all&q=implement&timezone=UTC',
    );
    expect(search.items).toEqual([]);
  });

  it('round-trips: export, delete everything, re-import, identical analytics', async () => {
    const before = await api.json<{
      totals: { events: number; prompts: number; sessions: number; projects: number };
    }>('/api/analytics/overview?range=all&timezone=UTC');
    const exported = (await (
      await api.get('/api/data/export?range=all&format=json&timezone=UTC')
    ).json()) as { events: Array<Record<string, unknown>> };

    const deleted = (await (
      await api.post('/api/data/delete', { scope: 'all', confirm: 'DELETE' })
    ).json()) as { events: number };
    expect(deleted.events).toBe(before.totals.events);

    const empty = await api.json<{ totals: { events: number } }>(
      '/api/analytics/overview?range=all&timezone=UTC',
    );
    expect(empty.totals.events).toBe(0);

    const reimported = exported.events.map((event) => ({
      externalId: event.id,
      eventType: event.eventType,
      timestamp: event.timestamp,
      sessionId: event.sessionId,
      model: event.model,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      workingDirectory: event.workingDirectory,
      tzOffsetMinutes: event.tzOffsetMinutes,
      prompt: event.promptText,
    }));
    const response = await ingest(reimported);
    expect(response.status).toBe(201);

    const after = await api.json<{
      totals: { events: number; sessions: number; projects: number };
    }>('/api/analytics/overview?range=all&timezone=UTC');
    expect(after.totals.events).toBe(before.totals.events);
    expect(after.totals.sessions).toBe(before.totals.sessions);
    expect(after.totals.projects).toBe(before.totals.projects);
  });
});

describe('settings', () => {
  it('defaults to redaction on and metadata-only off', async () => {
    const settings = await api.json<{ redactSecrets: boolean; metadataOnly: boolean }>(
      '/api/settings',
    );
    expect(settings.redactSecrets).toBe(true);
    expect(settings.metadataOnly).toBe(false);
  });

  it('persists a change and rejects an unknown value', async () => {
    const updated = (await (await api.post('/api/settings', undefined)).status) as number;
    expect([404, 405]).toContain(updated);

    const patch = await api.get('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idleTimeoutMinutes: 12 }),
    });
    expect(patch.status).toBe(200);
    expect(((await patch.json()) as { idleTimeoutMinutes: number }).idleTimeoutMinutes).toBe(12);

    const bad = await api.get('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idleTimeoutMinutes: 9999 }),
    });
    expect(bad.status).toBe(400);
  });

  it('stores nothing when metadata-only mode is on', async () => {
    await api.get('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metadataOnly: true }),
    });
    await ingest(seed(1, 'gamma', 3));

    const list = await api.json<{ items: Array<{ id: string; charLength: number }> }>(
      '/api/analytics/prompts?range=all&limit=200&timezone=UTC',
    );
    const gamma = list.items.find((i) => i.charLength > 0);
    expect(gamma).toBeDefined();

    const detail = await api.json<{ text: string | null; textAvailable: boolean }>(
      `/api/analytics/prompts/${gamma?.id}`,
    );
    expect(detail.textAvailable).toBe(false);
  });
});
