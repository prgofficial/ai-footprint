import { afterEach, describe, expect, it } from 'vitest';
import { createTempStore, fakeRecord, seedProjectAndSession, type TempStore } from './helpers';

let temp: TempStore | null = null;

afterEach(() => {
  temp?.cleanup();
  temp = null;
});

describe('idempotent ingest', () => {
  it('ingesting the same batch twice leaves exactly one row per event', () => {
    temp = createTempStore();
    seedProjectAndSession(temp.store);
    const records = Array.from({ length: 10_000 }, (_, index) => fakeRecord({ index }));

    const first = temp.store.events.ingestBatch(records);
    expect(first.accepted).toBe(10_000);
    expect(first.deduped).toBe(0);

    const second = temp.store.events.ingestBatch(records);
    expect(second.accepted).toBe(0);
    expect(second.deduped).toBe(10_000);

    expect(temp.store.events.countAll()).toBe(10_000);
    const prompts = temp.store.connection.prepare('SELECT COUNT(*) AS n FROM prompts').get() as {
      n: number;
    };
    expect(prompts.n).toBe(10_000);
  });

  it('improves a known event on a second sighting without duplicating it', () => {
    temp = createTempStore();
    seedProjectAndSession(temp.store);
    const bare = fakeRecord({ index: 1, eventType: 'response', model: null });
    bare.event.inputTokens = null;
    bare.event.outputTokens = null;
    temp.store.events.ingestBatch([bare]);

    const enriched = fakeRecord({ index: 1, eventType: 'response' });
    enriched.event.dedupeKey = bare.event.dedupeKey;
    temp.store.events.ingestBatch([enriched]);

    expect(temp.store.events.countAll()).toBe(1);
    const row = temp.store.connection
      .prepare('SELECT model, input_tokens AS inputTokens FROM events LIMIT 1')
      .get() as { model: string; inputTokens: number };
    expect(row.model).toBe('claude-opus-4-8');
    expect(row.inputTokens).toBe(100);
  });

  it('isolates a failing row without discarding the rest of the batch', () => {
    temp = createTempStore();
    seedProjectAndSession(temp.store);
    const good = fakeRecord({ index: 1 });
    const bad = fakeRecord({ index: 2 });
    bad.event.providerId = 'does-not-exist';

    const outcome = temp.store.events.ingestBatch([good, bad, fakeRecord({ index: 3 })]);
    expect(outcome.accepted).toBe(2);
    expect(outcome.failed).toBe(1);
    expect(temp.store.events.countAll()).toBe(2);
  });

  it('stays within the insert performance budget', () => {
    temp = createTempStore();
    seedProjectAndSession(temp.store);
    const records = Array.from({ length: 10_000 }, (_, index) => fakeRecord({ index }));
    const started = performance.now();
    temp.store.events.ingestBatch(records);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(5000);
  });
});

describe('full-text search', () => {
  it('round-trips text through the FTS index and survives deletion of prompt text', () => {
    temp = createTempStore();
    seedProjectAndSession(temp.store);
    temp.store.events.ingestBatch([
      fakeRecord({ index: 1, text: 'why does my docker swarm stack keep restarting' }),
      fakeRecord({ index: 2, text: 'refactor the react component tree' }),
    ]);

    const hits = temp.store.prompts.search({}, { query: 'docker swarm', limit: 10 });
    expect(hits.items).toHaveLength(1);
    expect(hits.items[0]?.preview).toContain('docker swarm');

    const prefix = temp.store.prompts.search({}, { query: 'refact', limit: 10 });
    expect(prefix.items).toHaveLength(1);

    const punctuation = temp.store.prompts.search(
      {},
      { query: 'why? does-my "docker"', limit: 10 },
    );
    expect(punctuation.items.length).toBeGreaterThanOrEqual(1);

    temp.store.maintenance.execute({ scope: 'prompts' });
    const afterDelete = temp.store.prompts.search({}, { query: 'docker', limit: 10 });
    expect(afterDelete.items).toHaveLength(0);
    expect(temp.store.events.countAll()).toBe(2);
  });

  it('paginates deep pages with a keyset cursor and never repeats a row', () => {
    temp = createTempStore();
    seedProjectAndSession(temp.store);
    temp.store.events.ingestBatch(Array.from({ length: 250 }, (_, index) => fakeRecord({ index })));

    const seen = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = temp.store.prompts.search({}, { limit: 50, cursor });
      for (const item of page.items) {
        expect(seen.has(item.id)).toBe(false);
        seen.add(item.id);
      }
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor && pages < 20);

    expect(seen.size).toBe(250);
    expect(pages).toBe(5);
  });
});
