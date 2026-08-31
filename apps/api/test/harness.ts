import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { bootstrap, type RunningApp } from '../src/bootstrap';

export interface TestApp {
  app: NestExpressApplication;
  url: string;
  port: number;
  token: string;
  home: string;
  close(): Promise<void>;
  get(path: string, init?: RequestInit): Promise<Response>;
  json<T>(path: string, init?: RequestInit): Promise<T>;
  post(path: string, body?: unknown, headers?: Record<string, string>): Promise<Response>;
}

/**
 * Every test gets its own data directory, so nothing here can see or touch the developer's
 * real AI Footprint database.
 */
export async function startTestApp(): Promise<TestApp> {
  const home = mkdtempSync(join(tmpdir(), 'af-api-'));
  process.env.AI_FOOTPRINT_HOME = home;
  process.env.AI_FOOTPRINT_TZ = 'UTC';

  let running: RunningApp;
  try {
    running = await bootstrap({ port: 0, logToFile: false, printBanner: false, webRoot: null });
  } catch (error) {
    rmSync(home, { recursive: true, force: true });
    throw error;
  }

  const runtimeConfig = JSON.parse(readFileSync(join(home, 'config', 'runtime.json'), 'utf8')) as {
    ingestToken: string;
  };

  const base = running.url;
  const request = (path: string, init: RequestInit = {}): Promise<Response> =>
    globalThis.fetch(`${base}${path}`, init);

  return {
    app: running.app,
    url: base,
    port: running.port,
    token: runtimeConfig.ingestToken,
    home,
    get: (path, init) => request(path, init),
    json: async <T>(path: string, init?: RequestInit): Promise<T> => {
      const response = await request(path, init);
      return (await response.json()) as T;
    },
    post: (path, body, headers = {}) =>
      request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    close: async () => {
      await running.close();
      delete process.env.AI_FOOTPRINT_HOME;
      delete process.env.AI_FOOTPRINT_TZ;
      rmSync(home, { recursive: true, force: true });
    },
  };
}

export interface SyntheticEvent {
  externalId: string;
  eventType: 'prompt' | 'response' | 'tool_call';
  timestamp: string;
  sessionId: string;
  prompt?: string;
  response?: string;
  toolName?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  workingDirectory?: string;
}

export function syntheticBatch(count: number, dayOffset = 0): SyntheticEvent[] {
  const base = Date.parse('2026-06-15T10:00:00.000Z') - dayOffset * 86_400_000;
  return Array.from({ length: count }, (_, index) => ({
    externalId: `syn-${dayOffset}-${index}`,
    eventType: 'prompt' as const,
    timestamp: new Date(base + index * 30_000).toISOString(),
    sessionId: `session-${dayOffset}`,
    prompt: `fix the failing test number ${index}`,
    workingDirectory: '/tmp/ai-footprint-test-project',
  }));
}
