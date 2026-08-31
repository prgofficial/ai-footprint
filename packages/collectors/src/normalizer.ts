import { createHash } from 'node:crypto';
import {
  dedupeKeyInput,
  INGEST_VERSION,
  modelFamilyOf,
  ulid,
  type AIEventInput,
} from '@ai-footprint/shared';
import {
  estimateCostUsd,
  fingerprint,
  preview,
  redact,
  sha256,
  wordCount,
} from '@ai-footprint/analytics';
import { localStamp, type IngestRecord } from '@ai-footprint/database';

export interface NormalizeOptions {
  redactSecrets: boolean;
  metadataOnly: boolean;
  storeResponses: boolean;
  defaultTzOffsetMinutes: number;
  projectIdFor(workingDirectory: string | null | undefined): string | null;
  sessionIdFor(providerId: string, externalSessionId: string | null | undefined): string | null;
}

export function computeDedupeKey(parts: Parameters<typeof dedupeKeyInput>[0]): string {
  return createHash('sha256').update(dedupeKeyInput(parts), 'utf8').digest('hex');
}

export function normalize(
  input: AIEventInput & { providerId: string },
  options: NormalizeOptions,
): IngestRecord {
  const timestamp = new Date(input.timestamp).toISOString();
  const tzOffsetMinutes = input.tzOffsetMinutes ?? options.defaultTzOffsetMinutes;
  const stamp = localStamp(timestamp, tzOffsetMinutes);
  const modelFamily = modelFamilyOf(input.model);

  const dedupeKey = computeDedupeKey({
    providerId: input.providerId,
    externalId: input.externalId,
    eventType: input.eventType,
    timestamp,
    discriminator: input.toolName ?? null,
    contentHash: input.externalId ? null : contentIdentity(input),
  });

  const estimatedCostUsd = estimateCostUsd(modelFamily, input);

  const record: IngestRecord = {
    event: {
      id: ulid(Date.parse(timestamp)),
      dedupeKey,
      providerId: input.providerId,
      product: input.product ?? null,
      model: input.model ?? null,
      modelFamily,
      timestamp,
      tzOffsetMinutes,
      localDate: stamp.localDate,
      localHour: stamp.localHour,
      localWeekday: stamp.localWeekday,
      sessionId: options.sessionIdFor(input.providerId, input.sessionId),
      externalId: input.externalId ?? null,
      parentEventId: input.parentEventId ?? null,
      isSubagent: input.isSubagent ?? false,
      projectId: options.projectIdFor(input.workingDirectory),
      workingDirectory: input.workingDirectory ?? null,
      repository: input.repository ?? null,
      gitBranch: input.gitBranch ?? null,
      eventType: input.eventType,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      cacheReadTokens: input.cacheReadTokens ?? null,
      cacheWriteTokens: input.cacheWriteTokens ?? null,
      estimatedCostUsd,
      durationMs: input.durationMs ?? null,
      sourceVersion: input.sourceVersion ?? null,
      ingestVersion: INGEST_VERSION,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  };

  if (input.eventType === 'prompt' && typeof input.prompt === 'string') {
    const raw = input.prompt;
    const redaction = options.redactSecrets ? redact(raw) : { text: raw, count: 0, kinds: [] };
    const stored = options.metadataOnly ? null : redaction.text;
    record.prompt = {
      text: stored,
      textHash: sha256(raw),
      normalizedHash: fingerprint(raw),
      charLength: raw.length,
      wordLength: wordCount(raw),
      redactionCount: redaction.count,
      preview: stored ? preview(redaction.text) : null,
    };
  }

  if (input.eventType === 'response' && typeof input.response === 'string') {
    const raw = input.response;
    const keep = options.storeResponses && !options.metadataOnly;
    // Scanning text nobody will store is pure cost on a multi-gigabyte import.
    const redaction =
      keep && options.redactSecrets ? redact(raw) : { text: raw, count: 0, kinds: [] };
    record.response = {
      text: keep ? redaction.text : null,
      charLength: raw.length,
      redactionCount: redaction.count,
    };
  }

  if (input.eventType === 'tool_call' && input.toolName) {
    record.toolCall = {
      toolName: input.toolName,
      succeeded: input.toolSucceeded ?? null,
      durationMs: input.durationMs ?? null,
      targetExtension: extensionFromMetadata(input.metadata),
    };
  }

  return record;
}

/**
 * What distinguishes two events from a source with no stable id. Byte-identical submissions
 * still collapse; two different events in the same millisecond stay two.
 */
function contentIdentity(input: AIEventInput & { providerId: string }): string {
  return sha256(
    JSON.stringify([
      input.sessionId ?? '',
      input.parentEventId ?? '',
      input.model ?? '',
      input.workingDirectory ?? '',
      input.toolName ?? '',
      input.prompt ?? '',
      input.response ?? '',
      input.inputTokens ?? null,
      input.outputTokens ?? null,
      input.cacheReadTokens ?? null,
      input.cacheWriteTokens ?? null,
    ]),
  );
}

function extensionFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const filePath = (metadata as { filePath?: unknown }).filePath;
  if (typeof filePath !== 'string') return null;
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(filePath);
  return match?.[1]?.toLowerCase() ?? null;
}
