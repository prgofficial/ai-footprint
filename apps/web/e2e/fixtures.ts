import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { APIRequestContext } from '@playwright/test';

const DAY = 86_400_000;
const ANCHOR = Date.now() - 2 * 3_600_000;

interface Seed {
  daysAgo: number;
  count: number;
  project: string;
  text: string;
  model: string;
}

/**
 * Sized above the observation floor on purpose: Insights refuses to speak below forty prompts,
 * so a smaller corpus would have left the product's most editorial screen untested.
 */
const SEEDS: Seed[] = [
  {
    daysAgo: 0,
    count: 14,
    project: 'aurora',
    text: 'fix the failing login test in the auth module',
    model: 'claude-opus-4-8',
  },
  {
    daysAgo: 1,
    count: 9,
    project: 'aurora',
    text: 'refactor the payment service to remove duplication',
    model: 'claude-opus-4-8',
  },
  {
    daysAgo: 2,
    count: 7,
    project: 'borealis',
    text: 'deploy the docker swarm stack to staging',
    model: 'claude-sonnet-4-5',
  },
  {
    daysAgo: 4,
    count: 10,
    project: 'aurora',
    text: 'write unit tests for the pricing calculator',
    model: 'claude-opus-4-8',
  },
  {
    daysAgo: 6,
    count: 5,
    project: 'borealis',
    text: 'explain how this react reducer works',
    model: 'claude-haiku-4-5',
  },
];

export function ingestToken(home: string): string {
  const raw = readFileSync(join(home, 'config', 'runtime.json'), 'utf8');
  return (JSON.parse(raw) as { ingestToken: string }).ingestToken;
}

export function buildEvents(): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  for (const seed of SEEDS) {
    const day = ANCHOR - seed.daysAgo * DAY;
    for (let index = 0; index < seed.count; index++) {
      const at = new Date(day - index * 180_000).toISOString();
      events.push({
        externalId: `e2e-${seed.project}-${seed.daysAgo}-p${index}`,
        eventType: 'prompt',
        timestamp: at,
        sessionId: `e2e-${seed.project}-${seed.daysAgo}`,
        prompt: `${seed.text} (${index})`,
        workingDirectory: `/tmp/ai-footprint-e2e/${seed.project}`,
        tzOffsetMinutes: 0,
      });
      events.push({
        externalId: `e2e-${seed.project}-${seed.daysAgo}-r${index}`,
        eventType: 'response',
        timestamp: new Date(day - index * 180_000 + 30_000).toISOString(),
        sessionId: `e2e-${seed.project}-${seed.daysAgo}`,
        model: seed.model,
        inputTokens: 1200,
        outputTokens: 340,
        cacheReadTokens: 8000,
        workingDirectory: `/tmp/ai-footprint-e2e/${seed.project}`,
        tzOffsetMinutes: 0,
      });
    }
  }
  return events;
}

export const TOTAL_PROMPTS = SEEDS.reduce((sum, seed) => sum + seed.count, 0);

export async function seedDatabase(request: APIRequestContext, home: string): Promise<void> {
  const response = await request.post('/api/ingest/events', {
    headers: { 'x-ai-footprint-token': ingestToken(home) },
    data: { providerId: 'claude-code', events: buildEvents() },
  });
  if (!response.ok()) throw new Error(`Seeding failed: ${response.status()}`);
  await request.post('/api/enrichment/run');
}
