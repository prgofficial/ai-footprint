import { afterEach, describe, expect, it } from 'vitest';
import { ACTIVE_TIME_TAIL_ALLOWANCE_MS, DEFAULT_IDLE_TIMEOUT_MS } from '@ai-footprint/shared';
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

describe('active time (plan §6.4)', () => {
  it('counts gaps up to the idle timeout and clamps anything longer', () => {
    temp = createTempStore();
    seedProjectAndSession(temp.store);

    // 0m ─2m─ 2m ─4h─ 4h02m ─1m─ 4h03m
    temp.store.events.ingestBatch([
      fakeRecord({ index: 1, timestamp: at(0) }),
      fakeRecord({ index: 2, timestamp: at(2 * 60_000) }),
      fakeRecord({ index: 3, timestamp: at(2 * 60_000 + 4 * 3_600_000) }),
      fakeRecord({ index: 4, timestamp: at(3 * 60_000 + 4 * 3_600_000) }),
    ]);
    temp.store.sessions.recomputeMetrics(
      ['session-1'],
      DEFAULT_IDLE_TIMEOUT_MS,
      ACTIVE_TIME_TAIL_ALLOWANCE_MS,
    );

    const session = temp.store.connection
      .prepare(
        'SELECT active_ms AS activeMs, duration_ms AS durationMs, prompt_count AS promptCount FROM sessions',
      )
      .get() as { activeMs: number; durationMs: number; promptCount: number };

    // 2 min + clamped 5 min + 1 min + 60 s tail
    expect(session.activeMs).toBe(2 * 60_000 + DEFAULT_IDLE_TIMEOUT_MS + 60_000 + 60_000);
    expect(session.durationMs).toBe(3 * 60_000 + 4 * 3_600_000);
    expect(session.promptCount).toBe(4);
    expect(session.activeMs).toBeLessThan(session.durationMs);
  });

  it('gives a single-event session only the tail allowance', () => {
    temp = createTempStore();
    seedProjectAndSession(temp.store);
    temp.store.events.ingestBatch([fakeRecord({ index: 1, timestamp: at(0) })]);
    temp.store.sessions.recomputeMetrics(
      ['session-1'],
      DEFAULT_IDLE_TIMEOUT_MS,
      ACTIVE_TIME_TAIL_ALLOWANCE_MS,
    );
    const row = temp.store.connection
      .prepare('SELECT active_ms AS activeMs FROM sessions')
      .get() as {
      activeMs: number;
    };
    expect(row.activeMs).toBe(ACTIVE_TIME_TAIL_ALLOWANCE_MS);
  });

  it('derives token totals and the primary model from the events', () => {
    temp = createTempStore();
    seedProjectAndSession(temp.store);
    temp.store.events.ingestBatch([
      fakeRecord({ index: 1, eventType: 'response', timestamp: at(0) }),
      fakeRecord({ index: 2, eventType: 'response', timestamp: at(60_000) }),
      fakeRecord({ index: 3, eventType: 'tool_call', timestamp: at(120_000), model: null }),
    ]);
    temp.store.sessions.recomputeMetrics(
      ['session-1'],
      DEFAULT_IDLE_TIMEOUT_MS,
      ACTIVE_TIME_TAIL_ALLOWANCE_MS,
    );
    const row = temp.store.connection
      .prepare(
        'SELECT input_tokens AS inputTokens, output_tokens AS outputTokens, tool_count AS toolCount, primary_model AS primaryModel FROM sessions',
      )
      .get() as {
      inputTokens: number;
      outputTokens: number;
      toolCount: number;
      primaryModel: string;
    };
    expect(row.inputTokens).toBe(200);
    expect(row.outputTokens).toBe(100);
    expect(row.toolCount).toBe(1);
    expect(row.primaryModel).toBe('claude-opus-4-8');
  });
});
