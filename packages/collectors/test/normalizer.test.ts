// hygiene:allow-secret-fixtures: these are published example credentials used to
// prove the redactor removes them. They grant no access to anything.
import { describe, expect, it } from 'vitest';
import { computeDedupeKey, normalize, type NormalizeOptions } from '../src/normalizer';
import type { AIEventInput } from '@ai-footprint/shared';

const options: NormalizeOptions = {
  redactSecrets: true,
  metadataOnly: false,
  storeResponses: false,
  defaultTzOffsetMinutes: 330,
  projectIdFor: () => 'project-1',
  sessionIdFor: (_provider, session) => (session ? `session:${session}` : null),
};

function input(overrides: Partial<AIEventInput> = {}): AIEventInput {
  return {
    providerId: 'claude-code',
    eventType: 'prompt',
    timestamp: '2026-06-01T20:15:00.000Z',
    externalId: 'uuid-1',
    prompt: 'refactor the payment service',
    ...overrides,
  } as AIEventInput;
}

describe('dedupe keys', () => {
  it('are stable for identical input and differ for anything meaningful', () => {
    const key = computeDedupeKey({
      providerId: 'claude-code',
      externalId: 'a',
      eventType: 'prompt',
      timestamp: 't',
    });
    expect(key).toBe(
      computeDedupeKey({
        providerId: 'claude-code',
        externalId: 'a',
        eventType: 'prompt',
        timestamp: 't',
      }),
    );
    expect(key).not.toBe(
      computeDedupeKey({
        providerId: 'claude-code',
        externalId: 'b',
        eventType: 'prompt',
        timestamp: 't',
      }),
    );
    expect(key).toHaveLength(64);
  });

  it('separates two tool calls emitted by the same assistant turn', () => {
    const a = normalize(
      input({ eventType: 'tool_call', toolName: 'Read', externalId: 'toolu_1' }),
      options,
    );
    const b = normalize(
      input({ eventType: 'tool_call', toolName: 'Edit', externalId: 'toolu_2' }),
      options,
    );
    expect(a.event.dedupeKey).not.toBe(b.event.dedupeKey);
  });

  it('is unchanged by a re-normalize, which is what makes re-scans safe', () => {
    const first = normalize(input(), options);
    const second = normalize(input(), options);
    expect(first.event.dedupeKey).toBe(second.event.dedupeKey);
    expect(first.event.id).not.toBe(second.event.id);
  });
});

describe('normalize', () => {
  it('stamps the local day and hour from the captured offset', () => {
    const record = normalize(input(), options);
    expect(record.event.tzOffsetMinutes).toBe(330);
    expect(record.event.localDate).toBe('2026-06-02');
    expect(record.event.localHour).toBe(1);
  });

  it('redacts credentials before the text is ever stored', () => {
    const record = normalize(
      input({
        prompt: 'deploy with AKIAIOSFODNN7EXAMPLE and ghp_abcdefghijklmnopqrstuvwxyz012345',
      }),
      options,
    );
    expect(record.prompt?.text).toContain('[redacted:aws_access_key]');
    expect(record.prompt?.text).toContain('[redacted:github_token]');
    expect(record.prompt?.text).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(record.prompt?.redactionCount).toBe(2);
  });

  it('records length and hashes from the original, not the redacted text', () => {
    const raw = 'deploy with AKIAIOSFODNN7EXAMPLE';
    const record = normalize(input({ prompt: raw }), options);
    expect(record.prompt?.charLength).toBe(raw.length);
    expect(record.prompt?.textHash).toHaveLength(64);
  });

  it('stores no text at all in metadata-only mode', () => {
    const record = normalize(input(), { ...options, metadataOnly: true });
    expect(record.prompt?.text).toBeNull();
    expect(record.prompt?.preview).toBeNull();
    expect(record.prompt?.charLength).toBeGreaterThan(0);
  });

  it('prices on the model id, not the family', () => {
    const priced = normalize(
      input({
        eventType: 'response',
        model: 'claude-opus-4-8',
        inputTokens: 1_000_000,
        outputTokens: 0,
      }),
      options,
    );
    // Opus 4.5 and later are $5/MTok input. Pricing by family charged the retired Opus 4.1
    // rate of $15 to every Opus, which overstated real histories threefold.
    expect(priced.event.estimatedCostUsd).toBeCloseTo(5, 5);

    const retired = normalize(
      input({
        eventType: 'response',
        model: 'claude-opus-4-1',
        inputTokens: 1_000_000,
        outputTokens: 0,
      }),
      options,
    );
    expect(retired.event.estimatedCostUsd).toBeCloseTo(15, 5);

    const unknown = normalize(
      input({ eventType: 'response', model: 'some-unreleased-model', inputTokens: 1_000_000 }),
      options,
    );
    expect(unknown.event.estimatedCostUsd).toBeNull();

    const noModel = normalize(input({ eventType: 'response', inputTokens: 1000 }), options);
    expect(noModel.event.estimatedCostUsd).toBeNull();
  });

  it('drops response text unless the user asked to keep it', () => {
    const dropped = normalize(input({ eventType: 'response', response: 'long answer' }), options);
    expect(dropped.response?.text).toBeNull();
    expect(dropped.response?.charLength).toBe(11);

    const kept = normalize(input({ eventType: 'response', response: 'long answer' }), {
      ...options,
      storeResponses: true,
    });
    expect(kept.response?.text).toBe('long answer');
  });
});
