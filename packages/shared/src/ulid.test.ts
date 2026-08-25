import { describe, expect, it } from 'vitest';
import { ulid, ulidTimestamp } from './ulid';
import { dedupeKeyInput, modelFamilyOf } from './event';

describe('ulid', () => {
  it('is 26 characters and sorts by time', () => {
    const early = ulid(1_000_000_000_000);
    const late = ulid(1_000_000_001_000);
    expect(early).toHaveLength(26);
    expect(early < late).toBe(true);
  });

  it('round-trips the embedded timestamp', () => {
    const now = Date.now();
    expect(ulidTimestamp(ulid(now))).toBe(now);
  });

  it('is unique across a large batch', () => {
    const ids = new Set(Array.from({ length: 20000 }, () => ulid()));
    expect(ids.size).toBe(20000);
  });
});

describe('dedupeKeyInput', () => {
  it('is stable for identical inputs and distinct otherwise', () => {
    const a = dedupeKeyInput({
      providerId: 'claude-code',
      externalId: 'x',
      eventType: 'prompt',
      timestamp: 't',
    });
    const b = dedupeKeyInput({
      providerId: 'claude-code',
      externalId: 'x',
      eventType: 'prompt',
      timestamp: 't',
    });
    const c = dedupeKeyInput({
      providerId: 'claude-code',
      externalId: 'x',
      eventType: 'response',
      timestamp: 't',
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('modelFamilyOf', () => {
  it('maps known model names and survives renames', () => {
    expect(modelFamilyOf('claude-opus-4-8')).toBe('opus');
    expect(modelFamilyOf('claude-sonnet-9-2-20301231')).toBe('sonnet');
    expect(modelFamilyOf('claude-haiku-4-5')).toBe('haiku');
    expect(modelFamilyOf('gpt-5')).toBe('gpt');
    expect(modelFamilyOf('some-future-model')).toBe('unknown');
    expect(modelFamilyOf(null)).toBeNull();
  });
});
