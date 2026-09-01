import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  INGEST_TOKEN_HEADER,
  type InsightsResponse,
  type OverviewResponse,
  type Paginated,
  type PromptListItem,
} from '@ai-footprint/shared';
import { startTestApp, type TestApp } from './harness';

let api: TestApp;

const DAY = 86_400_000;
// Anchored to the clock rather than a fixed date, so "last 7 days" means the same thing
// whenever the suite runs. Two hours back keeps every event safely in the past.
const ANCHOR = Date.now() - 2 * 3_600_000;

interface Seed {
  daysAgo: number;
  prompts: number;
  project: string;
  session: string;
  text: string;
  model?: string;
}

/** A deliberately shaped corpus, so every number below can be checked by hand. */
const SEEDS: Seed[] = [
  {
    daysAgo: 0,
    prompts: 6,
    project: 'alpha',
    session: 's-a0',
    text: 'fix the failing login test',
    model: 'claude-opus-4-8',
  },
  {
    daysAgo: 1,
    prompts: 4,
    project: 'alpha',
    session: 's-a1',
    text: 'refactor the payment service',
    model: 'claude-opus-4-8',
  },
  {
    daysAgo: 2,
    prompts: 3,
    project: 'beta',
    session: 's-b2',
    text: 'deploy the docker swarm stack',
    model: 'claude-sonnet-4-5',
  },
  {
    daysAgo: 9,
    prompts: 5,
    project: 'alpha',
    session: 's-a9',
    text: 'why does this crash on startup',
    model: 'claude-opus-4-8',
  },
  {
    daysAgo: 20,
    prompts: 2,
    project: 'beta',
    session: 's-b20',
    text: 'write unit tests for the parser',
    model: 'claude-haiku-4-5',
  },
];

function buildEvents() {
  const events: Array<Record<string, unknown>> = [];
  for (const seed of SEEDS) {
    const day = ANCHOR - seed.daysAgo * DAY;
    for (let i = 0; i < seed.prompts; i++) {
      const at = new Date(day - i * 120_000).toISOString();
      events.push({
        externalId: `${seed.session}-p${i}`,
        eventType: 'prompt',
        timestamp: at,
        sessionId: seed.session,
        prompt: seed.text,
        workingDirectory: `/tmp/af-test/${seed.project}`,
        tzOffsetMinutes: 0,
      });
      events.push({
        externalId: `${seed.session}-r${i}`,
        eventType: 'response',
        timestamp: new Date(day - i * 120_000 + 20_000).toISOString(),
        sessionId: seed.session,
        model: seed.model,
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 900,
        workingDirectory: `/tmp/af-test/${seed.project}`,
        tzOffsetMinutes: 0,
      });
    }
  }
  return events;
}

const TOTAL_PROMPTS = SEEDS.reduce((sum, s) => sum + s.prompts, 0);

beforeAll(async () => {
  api = await startTestApp();
  const response = await api.post(
    '/api/ingest/events',
    { providerId: 'claude-code', events: buildEvents() },
    { [INGEST_TOKEN_HEADER]: api.token },
  );
  expect(response.status).toBe(201);
  await api.post('/api/enrichment/run');
}, 60_000);

afterAll(async () => {
  await api?.close();
});

const overview = (range: string) =>
  api.json<OverviewResponse>(`/api/analytics/overview?range=${range}&timezone=UTC`);

describe('range resolution', () => {
  it('counts every prompt over all time', async () => {
    const body = await overview('all');
    expect(body.totals.prompts).toBe(TOTAL_PROMPTS);
    expect(body.totals.sessions).toBe(SEEDS.length);
    expect(body.totals.projects).toBe(2);
  });

  it('narrows correctly for a 7-day window', async () => {
    const body = await overview('7d');
    expect(body.totals.prompts).toBe(6 + 4 + 3);
  });

  it('rejects a custom range without both ends', async () => {
    const response = await api.get('/api/analytics/overview?range=custom');
    expect(response.status).toBe(400);
  });

  it('honours an explicit custom range', async () => {
    const from = new Date(ANCHOR - 2 * DAY).toISOString();
    const to = new Date(ANCHOR + DAY).toISOString();
    const body = await api.json<OverviewResponse>(
      `/api/analytics/overview?range=custom&from=${from}&to=${to}&timezone=UTC`,
    );
    expect(body.totals.prompts).toBe(6 + 4 + 3);
  });

  it('produces the same totals from the rollup path as from the event log', async () => {
    const viaEvents = await overview('7d');
    const viaRollups = await overview('30d');
    // 30d covers everything 7d covers plus the older seeds.
    expect(viaRollups.totals.prompts).toBe(TOTAL_PROMPTS);
    expect(viaRollups.totals.prompts).toBeGreaterThan(viaEvents.totals.prompts);
  });
});

describe('overview headline metrics', () => {
  it('reports one set of figures for the selected range and no second fixed window', async () => {
    const week = await overview('7d');
    const month = await overview('30d');

    expect(week).not.toHaveProperty('today');
    expect(week.period.prompts.value).toBe(week.totals.prompts);
    expect(week.period.prompts.value).toBe(6 + 4 + 3);
    expect(month.period.prompts.value).toBe(TOTAL_PROMPTS);
  });

  it('compares every headline against the window immediately before it', async () => {
    const week = await overview('7d');
    // The seven days before the last seven contain only the nine-day-old session.
    expect(week.period.prompts.previous).toBe(5);
    expect(week.period.prompts.changePct).toBe(160);
    expect(week.period.sessions.value).toBe(3);
    expect(week.period.sessions.previous).toBe(1);
  });

  it('carries the token split and cache counters behind the tokens headline', async () => {
    const week = await overview('7d');
    const replies = 6 + 4 + 3;
    expect(week.period.inputTokens).toBe(replies * 100);
    expect(week.period.outputTokens).toBe(replies * 50);
    expect(week.period.cacheReadTokens).toBe(replies * 900);
    expect(week.period.tokens.value).toBe(replies * 150);
    expect(week.period.tokens.previous).toBe(5 * 150);
  });

  it('gives cost a comparison rather than a bare number', async () => {
    const week = await overview('7d');
    // Opus 4.8 at $5/$25/$0.50 -> 0.0022 a reply; Sonnet 4.5 at $3/$15/$0.30 -> 0.00132.
    // 10 opus + 3 sonnet in the window, 5 opus in the one before.
    expect(week.period.estimatedCostUsd.value).toBeCloseTo(0.02596, 5);
    expect(week.period.estimatedCostUsd.previous).toBeCloseTo(0.011, 5);
    expect(week.period.estimatedCostUsd.changePct).toBe(136);
  });

  it('derives the per-session shape of the range', async () => {
    const week = await overview('7d');
    expect(week.period.promptsPerSession).toBeCloseTo(13 / 3, 2);
    expect(week.period.msPerSession).toBe(Math.round(week.period.activeMs.value / 3));
    expect(week.period.projects).toBe(2);
  });

  it('names the busiest bucket in the range', async () => {
    const week = await overview('7d');
    expect(week.granularity).toBe('day');
    expect(week.period.busiestBucket?.prompts).toBe(6);
  });

  it('counts models on the replies that carry them, from the event log', async () => {
    const week = await overview('7d');
    const byModel = Object.fromEntries(week.models.map((row) => [row.model, row.responses]));
    // Prompts have no model in a transcript, so counting them would report nothing at all.
    expect(byModel['claude-opus-4-8']).toBe(6 + 4);
    expect(byModel['claude-sonnet-4-5']).toBe(3);
    expect(week.models[0]?.share).toBeCloseTo(76.9, 1);
  });

  it('filters the whole overview by model, from the event log', async () => {
    // Prompts carry the model that answered them, so a model filter narrows every figure on
    // the page instead of emptying the prompt-derived half of it.
    const body = await api.json<OverviewResponse>(
      '/api/analytics/overview?range=7d&timezone=UTC&model=claude-sonnet-4-5',
    );
    expect(body.period.prompts.value).toBe(3);
    expect(body.totals.prompts).toBe(3);
    expect(body.categories.reduce((sum, row) => sum + row.prompts, 0)).toBe(3);
    expect(body.projects.map((row) => row.name)).toEqual(['beta']);
  });

  it('filters the whole overview by model, from the rollups', async () => {
    const body = await api.json<OverviewResponse>(
      '/api/analytics/overview?range=30d&timezone=UTC&model=claude-opus-4-8',
    );
    expect(body.period.prompts.value).toBe(6 + 4 + 5);
    expect(body.totals.prompts).toBe(6 + 4 + 5);
    // Three of the five sessions used this model; the rollups cannot say so on their own.
    expect(body.period.sessions.value).toBe(3);
  });

  it('narrows the prompt list by model too', async () => {
    const body = await api.json<Paginated<PromptListItem>>(
      '/api/analytics/prompts?range=all&timezone=UTC&model=claude-haiku-4-5&limit=50',
    );
    expect(body.items).toHaveLength(2);
    expect(body.items.every((item) => item.model === 'claude-haiku-4-5')).toBe(true);
  });

  it('counts models the same way from the rollups', async () => {
    const month = await overview('30d');
    const byModel = Object.fromEntries(month.models.map((row) => [row.model, row.responses]));
    expect(byModel['claude-opus-4-8']).toBe(6 + 4 + 5);
    expect(byModel['claude-sonnet-4-5']).toBe(3);
    expect(byModel['claude-haiku-4-5']).toBe(2);
    expect(month.models.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(100, 1);
  });
});

describe('aggregations', () => {
  it('attributes prompts to inferred projects', async () => {
    const body = await overview('all');
    const byName = Object.fromEntries(body.projects.map((p) => [p.name, p.prompts]));
    expect(byName.alpha).toBe(6 + 4 + 5);
    expect(byName.beta).toBe(3 + 2);
  });

  it('splits usage across models with token totals', async () => {
    const models = await api.json<
      Array<{
        model: string;
        events: number;
        prompts: number;
        responses: number;
        outputTokens: number;
      }>
    >('/api/analytics/models?range=all&timezone=UTC');
    const opus = models.find((m) => m.model === 'claude-opus-4-8');
    // Prompts are attributed to the model that answered them, so each pair counts twice.
    expect(opus?.responses).toBe(6 + 4 + 5);
    expect(opus?.prompts).toBe(6 + 4 + 5);
    expect(opus?.events).toBe((6 + 4 + 5) * 2);
    expect(opus?.outputTokens).toBe((6 + 4 + 5) * 50);
  });

  it('classifies prompts into the categories their wording implies', async () => {
    const categories = await api.json<Array<{ category: string; prompts: number }>>(
      '/api/analytics/categories?range=all&timezone=UTC',
    );
    const byName = Object.fromEntries(categories.map((c) => [c.category, c.prompts]));
    expect(byName.Debugging).toBe(6 + 5);
    expect(byName.Refactoring).toBe(4);
    expect(byName.DevOps).toBe(3);
    expect(byName.Testing).toBe(2);
  });

  it('detects technologies from the prompt text', async () => {
    const technologies = await api.json<Array<{ technology: string; prompts: number }>>(
      '/api/analytics/technologies?range=all&timezone=UTC',
    );
    expect(technologies.find((t) => t.technology === 'Docker')?.prompts).toBe(3);
  });

  it('buckets a timeseries by local day', async () => {
    const series = await api.json<{
      granularity: string;
      points: Array<{ bucket: string; prompts: number }>;
    }>('/api/analytics/timeseries?range=30d&timezone=UTC');
    expect(series.granularity).toBe('day');
    const busiest = series.points.reduce((max, p) => (p.prompts > max.prompts ? p : max));
    expect(busiest.prompts).toBe(6);
  });

  it('reports active time that is less than wall-clock session length', async () => {
    const sessions = await api.json<{
      items: Array<{ activeMs: number; durationMs: number; promptCount: number }>;
    }>('/api/analytics/sessions?range=all&limit=20&timezone=UTC');
    expect(sessions.items).toHaveLength(SEEDS.length);
    for (const session of sessions.items) {
      expect(session.activeMs).toBeGreaterThan(0);
      // Sub-millisecond drift is inherent to computing gaps through julianday.
      expect(session.activeMs).toBeLessThanOrEqual(session.durationMs + 60_001);
    }
  });
});

describe('prompt explorer', () => {
  it('finds prompts by full-text search', async () => {
    const found = await api.json<{ items: Array<{ preview: string }> }>(
      '/api/analytics/prompts?range=all&q=docker%20swarm&timezone=UTC',
    );
    expect(found.items).toHaveLength(3);
    expect(found.items[0]?.preview).toContain('docker swarm');
  });

  it('returns nothing for a term nobody typed', async () => {
    const found = await api.json<{ items: unknown[] }>(
      '/api/analytics/prompts?range=all&q=kubernetes&timezone=UTC',
    );
    expect(found.items).toEqual([]);
  });

  it('paginates with a cursor and never repeats a row', async () => {
    const seen = new Set<string>();
    let cursor: string | null | undefined;
    for (let page = 0; page < 10; page++) {
      const url = `/api/analytics/prompts?range=all&limit=5&timezone=UTC${cursor ? `&cursor=${cursor}` : ''}`;
      const body = await api.json<{ items: Array<{ id: string }>; nextCursor: string | null }>(url);
      for (const item of body.items) {
        expect(seen.has(item.id)).toBe(false);
        seen.add(item.id);
      }
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    expect(seen.size).toBe(TOTAL_PROMPTS);
  });

  it('exposes prompt detail with its classification and technologies', async () => {
    const list = await api.json<{ items: Array<{ id: string }> }>(
      '/api/analytics/prompts?range=all&q=docker&limit=1&timezone=UTC',
    );
    const id = list.items[0]?.id as string;
    const detail = await api.json<{ text: string; category: string; technologies: string[] }>(
      `/api/analytics/prompts/${id}`,
    );
    expect(detail.text).toContain('docker swarm');
    expect(detail.category).toBe('DevOps');
    expect(detail.technologies).toContain('Docker');
  });

  it('reports repeated prompts by normalised fingerprint', async () => {
    const body = await api.json<{ repeated: Array<{ count: number }> }>(
      '/api/analytics/prompts/analytics?range=all&timezone=UTC',
    );
    expect(body.repeated[0]?.count).toBe(6);
  });
});

describe('insights', () => {
  it('produces only insights backed by a row count', async () => {
    const body = await api.json<InsightsResponse>('/api/analytics/insights?range=all&timezone=UTC');
    expect(body.insights.length).toBeGreaterThan(0);
    for (const insight of body.insights) {
      expect(insight.evidence.sampleSize).toBeGreaterThan(0);
      expect(insight.evidence.value).toBeGreaterThan(0);
      expect(insight.headline.length).toBeGreaterThan(0);
    }
  });

  it('names the dominant category with the share the data actually shows', async () => {
    const body = await api.json<InsightsResponse>('/api/analytics/insights?range=all&timezone=UTC');
    const dominant = body.insights.find((i) => i.kind === 'dominant_category');
    expect(dominant?.headline).toContain('debugging');
    expect(dominant?.evidence.value).toBe(11);
  });

  it('suppresses everything when there is not enough data', async () => {
    const body = await api.json<InsightsResponse>(
      '/api/analytics/insights?range=today&timezone=UTC',
    );
    expect(body.insights).toEqual([]);
    expect(body.suppressed).toBeGreaterThan(0);
  });
});

describe('profile', () => {
  it('summarises the footprint from real counts', async () => {
    const profile = await api.json<{
      totalPrompts: number;
      mostActiveProject: { name: string } | null;
      mostUsedTool: { name: string } | null;
      hasEnoughData: boolean;
    }>('/api/analytics/profile?range=all&timezone=UTC');
    expect(profile.totalPrompts).toBe(TOTAL_PROMPTS);
    expect(profile.mostActiveProject?.name).toBe('alpha');
    expect(profile.mostUsedTool?.name).toBe('Claude Code');
    expect(profile.hasEnoughData).toBe(true);
  });
});
