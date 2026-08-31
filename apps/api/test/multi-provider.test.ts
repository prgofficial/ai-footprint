import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  INGEST_TOKEN_HEADER,
  type IngestResult,
  type ModelUsage,
  type OverviewResponse,
  type Paginated,
  type ProjectUsage,
  type ProviderSummary,
  type SessionSummary,
  type TimeseriesResponse,
} from '@ai-footprint/shared';
import { startTestApp, type TestApp } from './harness';

/**
 * The author of this product only has Claude Code. Every other tool reaches it through the
 * generic ingest endpoint, and that path used to be the least exercised code in the repo,
 * an audit that fed it four foreign tools found the endpoint answered HTTP 500 on its first
 * request, then silently destroyed events, then reported numbers that contradicted each other
 * between short and long ranges.
 *
 * So this file fabricates the corpus the author cannot produce: four tools, four model
 * families, three timezones, shared directories, colliding ids, a session across midnight, and
 * a model nobody publishes a price for. Every assertion below is a defect that shipped.
 */
let api: TestApp;

const DAY = 86_400_000;
const ANCHOR = Date.now() - 2 * 3_600_000;

function at(daysAgo: number, extraMs = 0): string {
  return new Date(ANCHOR - daysAgo * DAY + extraMs).toISOString();
}

/** Priced (Anthropic) and unpriced (everyone else), to keep the cost contract honest. */
const CLAUDE = 'claude-sonnet-5';
const GPT = 'gpt-5';
const GEMINI = 'gemini-2.5-pro';

interface Turn {
  provider: string;
  session: string;
  project: string;
  model: string;
  prompt: string;
  daysAgo: number;
  offset: number;
  /** Omitted on purpose for some turns: a foreign tool need not mint stable ids. */
  externalId?: string;
}

const TURNS: Turn[] = [
  // Cursor, India offset, in a directory Copilot also works in.
  {
    provider: 'cursor',
    session: 'cur-1',
    project: 'shop',
    model: GPT,
    prompt: 'refactor the auth guard in typescript',
    daysAgo: 1,
    offset: 330,
    externalId: 'cur-a',
  },
  {
    provider: 'cursor',
    session: 'cur-1',
    project: 'shop',
    model: GPT,
    prompt: 'write unit tests for the pricing calculator',
    daysAgo: 1,
    offset: 330,
    externalId: 'cur-b',
  },
  {
    provider: 'cursor',
    session: 'cur-2',
    project: 'billing',
    model: GPT,
    prompt: 'why does the invoice job crash on startup',
    daysAgo: 5,
    offset: 330,
    externalId: 'cur-c',
  },
  // GitHub Copilot: same session id string as Cursor, same directory, no external ids at all.
  {
    provider: 'github-copilot',
    session: 'cur-1',
    project: 'shop',
    model: GPT,
    prompt: 'explain how this react reducer works',
    daysAgo: 1,
    offset: -480,
  },
  {
    provider: 'github-copilot',
    session: 'cop-2',
    project: 'shop',
    model: GPT,
    prompt: 'deploy the docker swarm stack to staging',
    daysAgo: 5,
    offset: -480,
  },
  // Gemini CLI, UTC.
  {
    provider: 'gemini-cli',
    session: 'gem-1',
    project: 'billing',
    model: GEMINI,
    prompt: 'document the settlement flow',
    daysAgo: 3,
    offset: 0,
    externalId: 'gem-a',
  },
  // Claude Code, the only priced model in the corpus.
  {
    provider: 'claude-code',
    session: 'cc-1',
    project: 'shop',
    model: CLAUDE,
    prompt: 'fix the failing login test in the auth module',
    daysAgo: 3,
    offset: 0,
    externalId: 'cc-a',
  },
  {
    provider: 'claude-code',
    session: 'cc-1',
    project: 'shop',
    model: CLAUDE,
    prompt: 'review this migration for data loss',
    daysAgo: 3,
    offset: 0,
    externalId: 'cc-b',
  },
];

function buildEvents(): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  for (const [index, turn] of TURNS.entries()) {
    const base = {
      sessionId: turn.session,
      workingDirectory: `/tmp/af-mp/${turn.project}`,
      tzOffsetMinutes: turn.offset,
    };
    events.push({
      ...base,
      ...(turn.externalId ? { externalId: `${turn.externalId}-p` } : {}),
      providerId: turn.provider,
      eventType: 'prompt',
      timestamp: at(turn.daysAgo, index * 60_000),
      prompt: turn.prompt,
    });
    events.push({
      ...base,
      ...(turn.externalId ? { externalId: `${turn.externalId}-r` } : {}),
      providerId: turn.provider,
      eventType: 'response',
      timestamp: at(turn.daysAgo, index * 60_000 + 20_000),
      model: turn.model,
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 900,
    });
  }
  return events;
}

const TOTAL_PROMPTS = TURNS.length;
const PRICED_PROMPTS = TURNS.filter((t) => t.model === CLAUDE).length;

async function post(events: Array<Record<string, unknown>>, providerId = 'cursor') {
  return api.post(
    '/api/ingest/events',
    { providerId, events },
    { [INGEST_TOKEN_HEADER]: api.token },
  );
}

const overview = (query: string) =>
  api.json<OverviewResponse>(`/api/analytics/overview?timezone=UTC&${query}`);

beforeAll(async () => {
  api = await startTestApp();
  const response = await post(buildEvents());
  expect(response.status).toBe(201);
  await api.post('/api/enrichment/run');
}, 60_000);

afterAll(async () => {
  await api?.close();
});

describe('a tool with no adapter', () => {
  it('is registered by its first event instead of failing on a foreign key', async () => {
    const providers = await api.json<ProviderSummary[]>('/api/providers');
    const byId = Object.fromEntries(providers.map((p) => [p.id, p]));
    for (const id of ['cursor', 'github-copilot', 'gemini-cli']) {
      expect(byId[id], `${id} should be visible`).toBeDefined();
      expect(byId[id]?.eventCount).toBeGreaterThan(0);
    }
    // Named, not left as a bare slug.
    expect(byId['github-copilot']?.name).toBe('Github Copilot');
  });

  it('can be paused, and pausing actually stops it', async () => {
    const paused = await api.post('/api/providers/gemini-cli/disable', {});
    expect(paused.status, 'a push source must be pausable too').toBeLessThan(400);

    const response = await post([
      {
        providerId: 'gemini-cli',
        eventType: 'prompt',
        externalId: 'gem-while-paused',
        timestamp: at(0),
        sessionId: 'gem-1',
        prompt: 'this must not be stored',
        workingDirectory: '/tmp/af-mp/billing',
        tzOffsetMinutes: 0,
      },
    ]);
    const body = (await response.json()) as IngestResult;
    expect(body.skipped).toBe(1);
    expect(body.accepted).toBe(0);

    await api.post('/api/providers/gemini-cli/enable', {});
  });

  it('keeps a batch of the documented maximum size within the body limit', async () => {
    const events = Array.from({ length: 2000 }, (_, index) => ({
      providerId: 'bulk-tool',
      externalId: `bulk-${index}`,
      eventType: 'prompt' as const,
      timestamp: at(20, index * 1000),
      sessionId: 'bulk-1',
      prompt: `bulk prompt number ${index} about typescript and docker`,
      workingDirectory: '/tmp/af-mp/bulk',
      tzOffsetMinutes: 0,
    }));
    const response = await post(events, 'bulk-tool');
    // Previously a 500 from the 100 kB Express default, which made the documented cap a fiction.
    expect(response.status).toBe(201);
    expect(((await response.json()) as IngestResult).accepted).toBe(2000);
  });
});

describe('events that are not duplicates are not treated as duplicates', () => {
  it('keeps distinct events that share a timestamp and carry no external id', async () => {
    const timestamp = at(9);
    const response = await post(
      ['alpha rust', 'beta python', 'gamma kubernetes'].map((prompt, index) => ({
        providerId: 'no-ids-tool',
        eventType: 'prompt' as const,
        timestamp,
        sessionId: `sess-${index}`,
        prompt,
        workingDirectory: `/tmp/af-mp/no-ids-${index}`,
        tzOffsetMinutes: 0,
      })),
      'no-ids-tool',
    );
    expect(((await response.json()) as IngestResult).accepted).toBe(3);

    const listed = await api.json<Paginated<{ preview: string | null }>>(
      '/api/analytics/prompts?range=all&timezone=UTC&providerId=no-ids-tool&limit=50',
    );
    expect(listed.items.map((item) => item.preview).sort()).toEqual([
      'alpha rust',
      'beta python',
      'gamma kubernetes',
    ]);
  });

  it('still collapses a genuine re-submission of the same events', async () => {
    const timestamp = at(9);
    const again = await post(
      ['alpha rust', 'beta python', 'gamma kubernetes'].map((prompt, index) => ({
        providerId: 'no-ids-tool',
        eventType: 'prompt' as const,
        timestamp,
        sessionId: `sess-${index}`,
        prompt,
        workingDirectory: `/tmp/af-mp/no-ids-${index}`,
        tzOffsetMinutes: 0,
      })),
      'no-ids-tool',
    );
    const body = (await again.json()) as IngestResult;
    expect(body.accepted).toBe(0);
    expect(body.deduped).toBe(3);
  });

  it('keeps two tools apart when they use the same session id', async () => {
    const sessions = await api.json<Paginated<SessionSummary>>(
      '/api/analytics/sessions?range=all&timezone=UTC&limit=100',
    );
    const shared = sessions.items.filter((session) => session.externalId === 'cur-1');
    expect(shared).toHaveLength(2);
    expect(new Set(shared.map((session) => session.providerId))).toEqual(
      new Set(['cursor', 'github-copilot']),
    );
  });
});

describe('the short-range and long-range paths agree', () => {
  it('reports the same totals whichever path answers', async () => {
    const short = await overview('range=7d');
    const long = await overview('range=30d');
    const all = await overview('range=all');

    // Everything in the corpus is inside all three windows except the 9- and 20-day fixtures,
    // so compare the figures that must not depend on which path computed them.
    for (const key of ['events', 'prompts', 'sessions', 'projects'] as const) {
      expect(long.totals[key], `30d vs all: ${key}`).toBe(
        all.totals[key] - extrasBeyond30Days()[key],
      );
    }
    expect(short.period.prompts.value).toBeLessThanOrEqual(long.period.prompts.value);
  });

  it('counts every documented event type, not just three of them', async () => {
    const before = await overview('range=30d');
    await post(
      [
        {
          providerId: 'lifecycle-tool',
          externalId: 'lc-1',
          eventType: 'session_start',
          timestamp: at(4),
          sessionId: 'lc-1',
          workingDirectory: '/tmp/af-mp/lc',
          tzOffsetMinutes: 0,
        },
        {
          providerId: 'lifecycle-tool',
          externalId: 'lc-2',
          eventType: 'error',
          timestamp: at(4, 1000),
          sessionId: 'lc-1',
          workingDirectory: '/tmp/af-mp/lc',
          tzOffsetMinutes: 0,
        },
        {
          providerId: 'lifecycle-tool',
          externalId: 'lc-3',
          eventType: 'session_end',
          timestamp: at(4, 2000),
          sessionId: 'lc-1',
          workingDirectory: '/tmp/af-mp/lc',
          tzOffsetMinutes: 0,
        },
      ],
      'lifecycle-tool',
    );
    const after = await overview('range=30d');
    // The rollup totals used to sum only prompts + responses + tool calls, so a tool reporting
    // lifecycle events looked like it had no activity at all.
    expect(after.totals.events).toBe(before.totals.events + 3);
  });

  it('never reports a fabricated $0 for a model it cannot price', async () => {
    for (const range of ['7d', '30d', 'all']) {
      const body = await overview(`range=${range}&providerId=cursor`);
      expect(body.period.estimatedCostUsd.value, `${range} cost for an unpriced model`).toBeNull();
    }
  });

  it('does price the model it can, on both paths', async () => {
    const short = await overview('range=7d&providerId=claude-code');
    const long = await overview('range=30d&providerId=claude-code');
    expect(short.period.estimatedCostUsd.value).toBeGreaterThan(0);
    expect(long.period.estimatedCostUsd.value).toBeCloseTo(
      short.period.estimatedCostUsd.value ?? 0,
      6,
    );
  });

  it('reports real session counts on the timeline, not zero', async () => {
    for (const range of ['7d', '30d']) {
      const series = await api.json<TimeseriesResponse>(
        `/api/analytics/timeseries?range=${range}&timezone=UTC`,
      );
      const busy = series.points.filter((point) => point.prompts > 0);
      expect(busy.length).toBeGreaterThan(0);
      expect(
        busy.every((point) => point.sessions > 0),
        `${range} buckets should carry sessions`,
      ).toBe(true);
    }
  });

  it('does not invent sessions for a window with no events in it', async () => {
    const quiet = await overview(
      'range=custom&from=2019-01-01T00:00:00.000Z&to=2019-01-08T00:00:00.000Z',
    );
    expect(quiet.totals.prompts).toBe(0);
    expect(quiet.period.sessions.value).toBe(0);
  });
});

describe('a session that crosses local midnight', () => {
  it('is worth the same active time to a short range and a long one', async () => {
    await post(
      [
        {
          providerId: 'night-tool',
          externalId: 'n-1',
          eventType: 'prompt',
          timestamp: '2026-03-04T23:50:00.000Z',
          sessionId: 'night',
          prompt: 'debug the nightly settlement job',
          workingDirectory: '/tmp/af-mp/night',
          tzOffsetMinutes: 0,
        },
        {
          providerId: 'night-tool',
          externalId: 'n-2',
          eventType: 'response',
          timestamp: '2026-03-05T00:03:00.000Z',
          sessionId: 'night',
          model: GPT,
          inputTokens: 40,
          outputTokens: 10,
          tzOffsetMinutes: 0,
        },
      ],
      'night-tool',
    );

    const shortRange = await overview(
      'range=custom&from=2026-03-04T00:00:00.000Z&to=2026-03-05T23:59:59.999Z&providerId=night-tool',
    );
    const longRange = await overview(
      'range=custom&from=2026-02-01T00:00:00.000Z&to=2026-03-31T23:59:59.999Z&providerId=night-tool',
    );
    expect(longRange.period.activeMs.value).toBe(shortRange.period.activeMs.value);
    expect(shortRange.period.activeMs.value).toBeGreaterThan(0);
  });
});

describe('filters mean the same thing everywhere', () => {
  it('narrows every figure on the overview to one tool', async () => {
    const all = await overview('range=all');
    const cursor = await overview('range=all&providerId=cursor');
    expect(cursor.totals.prompts).toBe(3);
    expect(cursor.totals.prompts).toBeLessThan(all.totals.prompts);
    expect(cursor.sources.map((source) => source.providerId)).toEqual(['cursor']);
  });

  it('keeps two tools sharing a directory as one project with separable numbers', async () => {
    const shared = await api.json<ProjectUsage[]>('/api/analytics/projects?range=all&timezone=UTC');
    const shop = shared.find((project) => project.name === 'shop');
    expect(shop).toBeDefined();

    const cursorOnly = await api.json<ProjectUsage[]>(
      '/api/analytics/projects?range=all&timezone=UTC&providerId=cursor',
    );
    const shopForCursor = cursorOnly.find((project) => project.name === 'shop');
    // Active time used to come from all-time session totals with no filter, so picking either
    // tool showed the same combined figure for a shared directory.
    expect(shopForCursor?.activeMs).toBeLessThan(shop?.activeMs ?? Infinity);
  });

  it('lists a session that began before the window but worked inside it', async () => {
    const sessions = await api.json<Paginated<SessionSummary>>(
      '/api/analytics/sessions?range=7d&timezone=UTC&limit=100',
    );
    const counted = await overview('range=7d');
    expect(sessions.items.length).toBeGreaterThanOrEqual(counted.period.sessions.value);
  });

  it('opens a session detail that is not in the newest page', async () => {
    const sessions = await api.json<Paginated<SessionSummary>>(
      '/api/analytics/sessions?range=all&timezone=UTC&limit=100',
    );
    const oldest = sessions.items[sessions.items.length - 1];
    expect(oldest).toBeDefined();
    const detail = await api.get(`/api/analytics/sessions/${oldest?.id}`);
    expect(detail.status).toBe(200);
  });
});

describe('models across four families', () => {
  it('attributes a prompt to the model that answered it, per tool', async () => {
    const models = await api.json<ModelUsage[]>('/api/analytics/models?range=all&timezone=UTC');
    const byModel = Object.fromEntries(models.map((model) => [model.model, model]));
    expect(byModel[GPT]?.prompts).toBeGreaterThan(0);
    expect(byModel[GEMINI]?.prompts).toBe(1);
    expect(byModel[CLAUDE]?.prompts).toBe(PRICED_PROMPTS);
  });

  it("never lets one tool's model land on another tool's prompt", async () => {
    const gemini = await overview(`range=all&model=${GEMINI}`);
    expect(gemini.sources.map((source) => source.providerId)).toEqual(['gemini-cli']);
  });

  it('filters the whole page by model rather than emptying it', async () => {
    for (const range of ['7d', '30d', 'all']) {
      const body = await overview(`range=${range}&model=${GPT}`);
      expect(body.totals.prompts, `${range} prompts for ${GPT}`).toBeGreaterThan(0);
      expect(body.period.sessions.value).toBeGreaterThan(0);
    }
  });
});

describe('hostile and careless input', () => {
  it('answers a too-large body with 413 rather than an internal error', async () => {
    const huge = 'x'.repeat(40 * 1024 * 1024);
    const response = await post([
      {
        providerId: 'oversize-tool',
        externalId: 'huge',
        eventType: 'prompt',
        timestamp: at(1),
        sessionId: 's',
        prompt: huge,
        tzOffsetMinutes: 0,
      },
    ]);
    expect(response.status).toBe(413);
  });

  it('rejects a timestamp the database cannot store, and writes nothing', async () => {
    // The expanded-year form (`+033658-...`) is what a tool that mistakes microseconds for
    // milliseconds produces. SQLite cannot parse it, and it used to abort the ingest
    // transaction mid-flight: a 500 with raw SQL in it, the events already committed, and
    // every other session's metrics in the batch zeroed. It is refused up front now.
    const response = await post(
      [
        {
          providerId: 'clock-tool',
          externalId: 'bad-1',
          eventType: 'prompt',
          timestamp: new Date(1e15).toISOString(),
          sessionId: 'clock',
          prompt: 'a prompt from the year 33658',
          tzOffsetMinutes: 0,
        },
      ],
      'clock-tool',
    );
    expect(response.status).toBe(400);

    const after = await overview('range=all&providerId=clock-tool');
    expect(after.totals.events).toBe(0);
  });

  it("refuses a timezone it does not recognise instead of using the server's", async () => {
    const response = await api.get('/api/analytics/overview?range=7d&timezone=GMT%2B5%3A30');
    expect(response.status).toBe(400);
  });

  it('does not leak an internal error for an event id that does not exist', async () => {
    const response = await api.post('/api/events/does-not-exist/classify', { category: 'Testing' });
    expect(response.status).toBeLessThan(500);
  });
});

/** Fixtures deliberately placed outside a 30-day window, so the comparison above stays exact. */
function extrasBeyond30Days(): {
  events: number;
  prompts: number;
  sessions: number;
  projects: number;
} {
  return { events: 0, prompts: 0, sessions: 0, projects: 0 };
}

it('has a corpus worth trusting', () => {
  expect(TOTAL_PROMPTS).toBe(8);
  expect(new Set(TURNS.map((turn) => turn.provider)).size).toBe(4);
  expect(new Set(TURNS.map((turn) => turn.offset)).size).toBe(3);
});
