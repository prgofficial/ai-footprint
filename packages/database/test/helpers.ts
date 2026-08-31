import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localStamp } from '../src/time';
import { Store } from '../src/store';
import type { IngestRecord } from '../src/types';

export interface TempStore {
  store: Store;
  dir: string;
  cleanup: () => void;
}

export function createTempStore(): TempStore {
  const dir = mkdtempSync(join(tmpdir(), 'ai-footprint-test-'));
  const store = new Store({
    databasePath: join(dir, 'app.db'),
    paths: {
      root: dir,
      data: join(dir, 'data'),
      database: join(dir, 'app.db'),
      logs: join(dir, 'logs'),
      cache: join(dir, 'cache'),
      config: join(dir, 'config'),
      backups: join(dir, 'backups'),
      runtimeConfig: join(dir, 'config', 'runtime.json'),
    },
  });
  store.providers.register('claude-code', 'Claude Code');
  return {
    store,
    dir,
    cleanup: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export interface FakeEventOptions {
  index: number;
  providerId?: string;
  eventType?: 'prompt' | 'response' | 'tool_call';
  timestamp?: string;
  sessionId?: string | null;
  projectId?: string | null;
  model?: string | null;
  text?: string;
  tzOffsetMinutes?: number;
}

export function fakeRecord(options: FakeEventOptions): IngestRecord {
  const eventType = options.eventType ?? 'prompt';
  const timestamp =
    options.timestamp ?? new Date(1_760_000_000_000 + options.index * 60_000).toISOString();
  const tzOffsetMinutes = options.tzOffsetMinutes ?? 0;
  const stamp = localStamp(timestamp, tzOffsetMinutes);
  const id = `EVT${`${options.index}`.padStart(23, '0')}`;
  const text = options.text ?? `prompt number ${options.index}`;

  return {
    event: {
      id,
      dedupeKey: `${options.providerId ?? 'claude-code'}|ext-${options.index}|${eventType}|${timestamp}`,
      providerId: options.providerId ?? 'claude-code',
      product: 'Claude Code',
      model: options.model === undefined ? 'claude-opus-4-8' : options.model,
      modelFamily: options.model === null ? null : 'opus',
      timestamp,
      tzOffsetMinutes,
      localDate: stamp.localDate,
      localHour: stamp.localHour,
      localWeekday: stamp.localWeekday,
      sessionId: options.sessionId === undefined ? 'session-1' : options.sessionId,
      externalId: `ext-${options.index}`,
      parentEventId: null,
      isSubagent: false,
      projectId: options.projectId === undefined ? 'project-1' : options.projectId,
      workingDirectory: '/tmp/project-1',
      repository: null,
      gitBranch: 'main',
      eventType,
      inputTokens: eventType === 'response' ? 100 : null,
      outputTokens: eventType === 'response' ? 50 : null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      estimatedCostUsd: eventType === 'response' ? 0.01 : null,
      durationMs: null,
      sourceVersion: '2.0.0',
      ingestVersion: 1,
      metadataJson: null,
    },
    prompt:
      eventType === 'prompt'
        ? {
            text,
            textHash: `hash-${options.index}`,
            normalizedHash: `norm-${options.index % 7}`,
            charLength: text.length,
            wordLength: text.split(' ').length,
            redactionCount: 0,
            preview: text.slice(0, 160),
          }
        : undefined,
  };
}

export function seedProjectAndSession(store: Store): void {
  store.projects.upsertMany([
    {
      id: 'project-1',
      path: '/tmp/project-1',
      name: 'project-1',
      repository: null,
      gitRemote: null,
      seenAt: new Date(1_760_000_000_000).toISOString(),
    },
  ]);
  store.sessions.upsertMany([
    {
      id: 'session-1',
      providerId: 'claude-code',
      externalId: 'session-1',
      projectId: 'project-1',
      startedAt: new Date(1_760_000_000_000).toISOString(),
      endedAt: null,
      primaryModel: 'claude-opus-4-8',
      endReason: null,
    },
  ]);
}
