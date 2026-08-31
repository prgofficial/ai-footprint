import { afterEach, describe, expect, it } from 'vitest';
import { createTempStore, fakeRecord, seedProjectAndSession, type TempStore } from './helpers';

let temp: TempStore | null = null;
const BASE = 1_760_000_000_000;

afterEach(() => {
  temp?.cleanup();
  temp = null;
});

function at(offsetMs: number): string {
  return new Date(BASE + offsetMs).toISOString();
}

function promptModels(store: TempStore['store']): Array<{ id: string; model: string | null }> {
  return store.connection
    .prepare(
      `SELECT id, model, model_family AS modelFamily FROM events
        WHERE event_type = 'prompt' ORDER BY timestamp`,
    )
    .all() as Array<{ id: string; model: string | null; modelFamily: string | null }>;
}

/**
 * A transcript never stamps the model on the prompt, only on the reply, so this is the rule
 * that makes a prompt countable against a model at all, and makes the model filter mean
 * something instead of matching nothing.
 */
describe('attributing a prompt to the model that answered it', () => {
  it('takes the model from the first reply after the prompt', () => {
    temp = createTempStore();
    seedProjectAndSession(temp.store);
    temp.store.events.ingestBatch([
      fakeRecord({ index: 1, timestamp: at(0), model: null }),
      fakeRecord({ index: 2, timestamp: at(1_000), eventType: 'response', model: 'claude-opus-5' }),
    ]);

    temp.store.events.linkPromptModels(['session-1']);

    const rows = temp.store.connection
      .prepare(`SELECT model, model_family AS family FROM events WHERE event_type = 'prompt'`)
      .get() as { model: string | null; family: string | null };
    expect(rows.model).toBe('claude-opus-5');
    expect(rows.family).toBe('opus');
  });

  it('attributes a prompt whose reply only arrives in a later batch', () => {
    temp = createTempStore();
    seedProjectAndSession(temp.store);

    // The realtime case: the prompt is on disk and read seconds before the reply exists.
    temp.store.events.ingestBatch([fakeRecord({ index: 1, timestamp: at(0), model: null })]);
    expect(temp.store.events.linkPromptModels(['session-1'])).toEqual([]);
    expect(promptModels(temp.store)[0]?.model).toBeNull();

    temp.store.events.ingestBatch([
      fakeRecord({ index: 2, timestamp: at(4_000), eventType: 'response', model: 'claude-opus-5' }),
    ]);
    expect(temp.store.events.linkPromptModels(['session-1'])).toHaveLength(1);
    expect(promptModels(temp.store)[0]?.model).toBe('claude-opus-5');
  });

  it('leaves a prompt nobody answered alone rather than borrowing a model', () => {
    temp = createTempStore();
    seedProjectAndSession(temp.store);
    temp.store.events.ingestBatch([
      fakeRecord({ index: 1, timestamp: at(0), model: null }),
      fakeRecord({ index: 2, timestamp: at(1_000), eventType: 'response', model: 'claude-opus-5' }),
      // Asked, then interrupted before anything came back.
      fakeRecord({ index: 3, timestamp: at(2_000), model: null }),
    ]);

    temp.store.events.linkPromptModels(['session-1']);

    const models = promptModels(temp.store).map((row) => row.model);
    expect(models).toEqual(['claude-opus-5', null]);
  });

  it('skips the placeholder the CLI writes for its own messages', () => {
    temp = createTempStore();
    seedProjectAndSession(temp.store);
    temp.store.events.ingestBatch([
      fakeRecord({ index: 1, timestamp: at(0), model: null }),
      fakeRecord({
        index: 2,
        timestamp: at(1_000),
        eventType: 'response',
        model: '<synthetic>',
        modelFamily: null,
      }),
      fakeRecord({
        index: 3,
        timestamp: at(2_000),
        eventType: 'response',
        model: 'claude-sonnet-5',
      }),
    ]);

    temp.store.events.linkPromptModels(['session-1']);
    expect(promptModels(temp.store)[0]?.model).toBe('claude-sonnet-5');
  });

  it('does not answer a parent prompt with a subagent reply', () => {
    temp = createTempStore();
    seedProjectAndSession(temp.store);
    temp.store.events.ingestBatch([
      fakeRecord({ index: 1, timestamp: at(0), model: null }),
      // A subagent shares the parent's session id, so only the flag separates the two sides.
      fakeRecord({
        index: 2,
        timestamp: at(1_000),
        eventType: 'response',
        model: 'claude-haiku-4-5-20251001',
        isSubagent: true,
      }),
      fakeRecord({ index: 3, timestamp: at(2_000), eventType: 'response', model: 'claude-opus-5' }),
    ]);

    temp.store.events.linkPromptModels(['session-1']);
    expect(promptModels(temp.store)[0]?.model).toBe('claude-opus-5');
  });

  it('reports every day it changed, including one a reply crossed midnight into', () => {
    temp = createTempStore();
    seedProjectAndSession(temp.store);
    const midnight = Date.parse('2026-03-04T00:00:00.000Z');
    temp.store.events.ingestBatch([
      fakeRecord({ index: 1, timestamp: new Date(midnight - 2_000).toISOString(), model: null }),
      fakeRecord({
        index: 2,
        timestamp: new Date(midnight + 2_000).toISOString(),
        eventType: 'response',
        model: 'claude-opus-5',
      }),
    ]);

    const days = temp.store.events.linkPromptModels(['session-1']);
    expect(days).toEqual([{ day: '2026-03-03', providerId: 'claude-code' }]);
  });

  it('is a no-op once every prompt is attributed', () => {
    temp = createTempStore();
    seedProjectAndSession(temp.store);
    temp.store.events.ingestBatch([
      fakeRecord({ index: 1, timestamp: at(0), model: null }),
      fakeRecord({ index: 2, timestamp: at(1_000), eventType: 'response', model: 'claude-opus-5' }),
    ]);

    expect(temp.store.events.linkPromptModels(['session-1'])).toHaveLength(1);
    expect(temp.store.events.linkPromptModels(['session-1'])).toEqual([]);
    expect(temp.store.events.linkPromptModels([])).toEqual([]);
  });
});

describe('rebuilding the derived tables', () => {
  it('asks for a rebuild when a migration has emptied the rollups', () => {
    temp = createTempStore();
    seedProjectAndSession(temp.store);
    expect(temp.store.rollups.needsRebuild()).toBe(false);

    temp.store.events.ingestBatch([fakeRecord({ index: 1, timestamp: at(0) })]);
    expect(temp.store.rollups.needsRebuild()).toBe(true);

    temp.store.rollups.rebuildAll();
    expect(temp.store.rollups.needsRebuild()).toBe(false);

    temp.store.rollups.clear();
    expect(temp.store.rollups.needsRebuild()).toBe(true);
  });
});
