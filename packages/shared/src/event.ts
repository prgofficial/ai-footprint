import type { EventType, ModelFamily } from './enums';

/**
 * The provider-agnostic event every adapter must produce. Nothing downstream of the
 * normalizer knows which tool an event came from.
 */
export interface AIEvent {
  id: string;
  /** Stable across re-scans; the UNIQUE key that makes ingestion idempotent. */
  dedupeKey: string;

  providerId: string;
  product?: string | null;
  model?: string | null;
  modelFamily?: ModelFamily | null;

  timestamp: string;
  /** Captured at ingest so local-hour analytics survive travel and DST. */
  tzOffsetMinutes: number;

  sessionId?: string | null;
  externalId?: string | null;
  parentEventId?: string | null;
  isSubagent: boolean;

  projectId?: string | null;
  workingDirectory?: string | null;
  repository?: string | null;
  gitBranch?: string | null;

  eventType: EventType;

  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
  /** The 1-hour share of `cacheWriteTokens`, which bills at twice the 5-minute rate. */
  cacheWrite1hTokens?: number | null;
  /** Null whenever the model is unknown. Never guessed. */
  estimatedCostUsd?: number | null;

  durationMs?: number | null;
  sourceVersion?: string | null;
  ingestVersion: number;
  metadata?: Record<string, unknown> | null;
}

/** Concatenated into the dedupe hash. Kept pure so it is identical on every platform. */
export function dedupeKeyInput(parts: {
  providerId: string;
  externalId?: string | null;
  eventType: string;
  timestamp: string;
  discriminator?: string | null;
  /**
   * Stands in for `externalId` when the source has no stable id. Without it two unrelated
   * events sharing a millisecond collapse into one, and the survivor inherits the other's
   * session, project, model and tokens.
   */
  contentHash?: string | null;
}): string {
  // An external id IS the event's identity, so the clock is not part of the key when one is
  // supplied. Including it meant Claude Code's streaming, which rewrites the same assistant
  // message to the transcript several times, seconds apart, with byte-identical token counts,
  // produced one event per rewrite. Measured over 130,125 real assistant records: 30,362 actual
  // replies counted as 130,125 events, inflating every token and cost figure by 4.1x.
  if (parts.externalId) {
    return [parts.providerId, parts.externalId, parts.eventType, parts.discriminator ?? ''].join(
      '|',
    );
  }

  // With no id, the clock is all that separates the same question asked twice.
  return [
    parts.providerId,
    parts.contentHash ? `#${parts.contentHash}` : '',
    parts.eventType,
    parts.timestamp,
    parts.discriminator ?? '',
  ].join('|');
}

const FAMILY_PATTERNS: ReadonlyArray<readonly [RegExp, ModelFamily]> = [
  [/fable|mythos/i, 'opus'],
  [/opus/i, 'opus'],
  [/sonnet/i, 'sonnet'],
  [/haiku/i, 'haiku'],
  [/^gpt|openai|o[134]-/i, 'gpt'],
  [/gemini/i, 'gemini'],
  [/llama/i, 'llama'],
];

export function modelFamilyOf(model: string | null | undefined): ModelFamily | null {
  if (!model) return null;
  for (const [pattern, family] of FAMILY_PATTERNS) {
    if (pattern.test(model)) return family;
  }
  return 'unknown';
}
