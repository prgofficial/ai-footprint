import type { EventType } from '@ai-footprint/shared';

export interface EventRow {
  id: string;
  dedupeKey: string;
  providerId: string;
  product: string | null;
  model: string | null;
  modelFamily: string | null;
  timestamp: string;
  tzOffsetMinutes: number;
  localDate: string;
  localHour: number;
  localWeekday: number;
  sessionId: string | null;
  externalId: string | null;
  parentEventId: string | null;
  isSubagent: boolean;
  projectId: string | null;
  workingDirectory: string | null;
  repository: string | null;
  gitBranch: string | null;
  eventType: EventType;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  estimatedCostUsd: number | null;
  durationMs: number | null;
  sourceVersion: string | null;
  ingestVersion: number;
  metadataJson: string | null;
}

export interface PromptRow {
  text: string | null;
  textHash: string;
  normalizedHash: string;
  charLength: number;
  wordLength: number;
  redactionCount: number;
  preview: string | null;
}

export interface ResponseRow {
  text: string | null;
  charLength: number;
  redactionCount: number;
}

export interface ToolCallRow {
  toolName: string;
  succeeded: boolean | null;
  durationMs: number | null;
  targetExtension: string | null;
}

export interface IngestRecord {
  event: EventRow;
  prompt?: PromptRow;
  response?: ResponseRow;
  toolCall?: ToolCallRow;
}

export interface IngestOutcome {
  accepted: number;
  deduped: number;
  failed: number;
  acceptedIds: string[];
  touchedDays: Array<{ day: string; providerId: string }>;
}
