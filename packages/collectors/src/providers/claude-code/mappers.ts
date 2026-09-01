import type { AIEventInput, EventType } from '@ai-footprint/shared';
import type { TranscriptContentBlock, TranscriptRecord } from './records';

export const PROVIDER_ID = 'claude-code';
export const PRODUCT_NAME = 'Claude Code';

export interface MapContext {
  storeResponses: boolean;
  toolResultOutcomes: Map<string, boolean>;
}

function contentBlocks(record: TranscriptRecord): TranscriptContentBlock[] {
  const content = record.message?.content;
  if (Array.isArray(content)) return content;
  return [];
}

function plainText(record: TranscriptRecord): string {
  const content = record.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n')
    .trim();
}

/**
 * A `user` record is only a human prompt when it is not a tool result, not injected
 * metadata, and actually carries text. Everything else in that channel is machinery.
 */
export function isHumanPrompt(record: TranscriptRecord): boolean {
  if (record.type !== 'user') return false;
  if (record.isMeta) return false;
  const content = record.message?.content;
  if (typeof content === 'string') return content.trim().length > 0;
  if (!Array.isArray(content)) return false;
  if (content.some((block) => block?.type === 'tool_result')) return false;
  return content.some((block) => block?.type === 'text' && (block.text ?? '').trim().length > 0);
}

function base(record: TranscriptRecord, eventType: EventType, externalId: string): AIEventInput {
  return {
    providerId: PROVIDER_ID,
    product: PRODUCT_NAME,
    externalId,
    eventType,
    timestamp: record.timestamp as string,
    sessionId: record.sessionId ?? null,
    parentEventId: record.parentUuid ?? null,
    isSubagent: record.isSidechain === true,
    workingDirectory: record.cwd ?? null,
    gitBranch: record.gitBranch ?? null,
    sourceVersion: record.version ?? null,
  };
}

export function mapRecord(record: TranscriptRecord, ctx: MapContext): AIEventInput[] {
  if (!record.timestamp || Number.isNaN(Date.parse(record.timestamp))) return [];

  const events: AIEventInput[] = [];

  if (record.type === 'user' && isHumanPrompt(record)) {
    const text = plainText(record);
    if (text.length > 0) {
      const event = base(record, 'prompt', record.uuid ?? `${record.promptId}`);
      event.prompt = text;
      event.metadata = compactMetadata({
        promptId: record.promptId,
        promptSource: record.promptSource,
        permissionMode: record.permissionMode,
        effort: record.effort,
        entrypoint: record.entrypoint,
      });
      events.push(event);
    }
  }

  if (record.type === 'user' && Array.isArray(record.message?.content)) {
    for (const block of record.message.content) {
      if (block?.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        ctx.toolResultOutcomes.set(block.tool_use_id, block.is_error !== true);
      }
    }
  }

  if (record.type === 'assistant') {
    const usage = record.message?.usage;
    const model = record.message?.model ?? null;
    const text = plainText(record);

    if (usage || model) {
      // `message.id` identifies the assistant's REPLY. `record.uuid` identifies the transcript
      // LINE, and streaming writes one reply across several lines carrying the same usage.
      // Keying on the line counted a single reply as many.
      const replyId = record.message?.id ?? record.uuid ?? (record.requestId as string);
      const event = base(record, 'response', replyId);
      event.model = model;
      event.inputTokens = usage?.input_tokens ?? null;
      event.outputTokens = usage?.output_tokens ?? null;
      event.cacheReadTokens = usage?.cache_read_input_tokens ?? null;
      event.cacheWriteTokens = usage?.cache_creation_input_tokens ?? null;
      // Claude Code writes 1-hour caches, which bill at 2x input rather than 1.25x. The split
      // is in the transcript; reading only the flat total understated the write line by 40%.
      event.cacheWrite1hTokens = usage?.cache_creation?.ephemeral_1h_input_tokens ?? null;
      if (ctx.storeResponses && text) event.response = text;
      event.metadata = compactMetadata({
        stopReason: record.message?.stop_reason,
        serviceTier: usage?.service_tier,
        requestId: record.requestId,
      });
      events.push(event);
    }

    for (const block of contentBlocks(record)) {
      if (block?.type !== 'tool_use' || typeof block.name !== 'string') continue;
      const toolUseId = block.id ?? `${record.uuid}-${block.name}`;
      const event = base(record, 'tool_call', toolUseId);
      event.model = model;
      event.toolName = block.name;
      event.toolSucceeded = ctx.toolResultOutcomes.get(toolUseId) ?? null;
      event.metadata = compactMetadata({ filePath: toolFilePath(block) });
      events.push(event);
    }
  }

  if (record.compactMetadata) {
    const event = base(record, 'compaction', record.uuid ?? `${record.sessionId}-compaction`);
    event.metadata = compactMetadata({ compaction: true });
    events.push(event);
  }

  if (record.isApiErrorMessage) {
    const event = base(record, 'error', record.uuid ?? `${record.sessionId}-error`);
    event.metadata = compactMetadata({ kind: 'api_error' });
    events.push(event);
  }

  return events;
}

function toolFilePath(block: TranscriptContentBlock): string | undefined {
  const input = block.input;
  if (!input || typeof input !== 'object') return undefined;
  const candidate = input as { file_path?: unknown; path?: unknown; notebook_path?: unknown };
  for (const value of [candidate.file_path, candidate.path, candidate.notebook_path]) {
    if (typeof value === 'string') return value;
  }
  return undefined;
}

function compactMetadata(input: Record<string, unknown>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === '') continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * A tool_result always arrives after the tool_use it answers, so success is unknown at the
 * moment the call is mapped. Chunks are resolved as a second pass once the whole chunk has
 * been read; a call whose result lands in the next chunk stays unknown rather than wrong.
 */
export function applyToolOutcomes(
  events: AIEventInput[],
  outcomes: Map<string, boolean>,
): AIEventInput[] {
  for (const event of events) {
    if (event.eventType !== 'tool_call' || event.toolSucceeded != null) continue;
    if (!event.externalId) continue;
    const outcome = outcomes.get(event.externalId);
    if (outcome !== undefined) event.toolSucceeded = outcome;
  }
  return events;
}

export interface SessionBoundary {
  externalId: string;
  startedAt: string;
  endedAt: string;
  primaryModel: string | null;
  workingDirectory: string | null;
}

export function sessionBoundaryFrom(events: AIEventInput[]): Map<string, SessionBoundary> {
  const sessions = new Map<string, SessionBoundary>();
  for (const event of events) {
    if (!event.sessionId) continue;
    const existing = sessions.get(event.sessionId);
    if (!existing) {
      sessions.set(event.sessionId, {
        externalId: event.sessionId,
        startedAt: event.timestamp,
        endedAt: event.timestamp,
        primaryModel: event.model ?? null,
        workingDirectory: event.workingDirectory ?? null,
      });
      continue;
    }
    if (event.timestamp < existing.startedAt) existing.startedAt = event.timestamp;
    if (event.timestamp > existing.endedAt) existing.endedAt = event.timestamp;
    if (!existing.primaryModel && event.model) existing.primaryModel = event.model;
    if (!existing.workingDirectory && event.workingDirectory) {
      existing.workingDirectory = event.workingDirectory;
    }
  }
  return sessions;
}
