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
}): string {
  return [
    parts.providerId,
    parts.externalId ?? '',
    parts.eventType,
    parts.timestamp,
    parts.discriminator ?? '',
  ].join('|');
}

const FAMILY_PATTERNS: ReadonlyArray<readonly [RegExp, ModelFamily]> = [
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
