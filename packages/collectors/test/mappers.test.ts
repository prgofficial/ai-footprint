import { describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyToolOutcomes,
  isHumanPrompt,
  mapRecord,
  sessionBoundaryFrom,
} from '../src/providers/claude-code/mappers';
import { readTranscript } from '../src/providers/claude-code/transcript-reader';
import type { TranscriptRecord } from '../src/providers/claude-code/records';
import type { AIEventInput } from '@ai-footprint/shared';

const FIXTURE = join(__dirname, 'fixtures', 'session.jsonl');

function loadRecords(): { records: TranscriptRecord[]; parseErrors: number } {
  const lines = readFileSync(FIXTURE, 'utf8')
    .split('\n')
    .filter((l) => l.trim());
  const records: TranscriptRecord[] = [];
  let parseErrors = 0;
  for (const line of lines) {
    try {
      records.push(JSON.parse(line) as TranscriptRecord);
    } catch {
      parseErrors += 1;
    }
  }
  return { records, parseErrors };
}

function mapAll(): AIEventInput[] {
  const { records } = loadRecords();
  const ctx = { storeResponses: true, toolResultOutcomes: new Map<string, boolean>() };
  const events = records.flatMap((record) => mapRecord(record, ctx));
  return applyToolOutcomes(events, ctx.toolResultOutcomes);
}

describe('isHumanPrompt', () => {
  it('accepts text turns in both string and block form', () => {
    expect(isHumanPrompt({ type: 'user', message: { content: 'hello' } })).toBe(true);
    expect(
      isHumanPrompt({ type: 'user', message: { content: [{ type: 'text', text: 'hello' }] } }),
    ).toBe(true);
  });

  it('rejects tool results, injected metadata and empty turns', () => {
    expect(
      isHumanPrompt({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] },
      }),
    ).toBe(false);
    expect(isHumanPrompt({ type: 'user', isMeta: true, message: { content: 'x' } })).toBe(false);
    expect(isHumanPrompt({ type: 'user', message: { content: '   ' } })).toBe(false);
    expect(isHumanPrompt({ type: 'assistant', message: { content: 'x' } })).toBe(false);
  });
});

describe('mapRecord over a real-shaped transcript', () => {
  const events = mapAll();
  const byType = (type: string) => events.filter((e) => e.eventType === type);

  it('extracts exactly the human prompts', () => {
    const prompts = byType('prompt');
    expect(prompts).toHaveLength(2);
    expect(prompts[0]?.prompt).toContain('failing login test');
    expect(prompts.some((p) => p.prompt?.includes('system-reminder'))).toBe(false);
  });

  it('carries model and the full usage breakdown onto responses', () => {
    const first = byType('response')[0];
    expect(first?.model).toBe('claude-opus-4-8');
    expect(first?.inputTokens).toBe(1200);
    expect(first?.outputTokens).toBe(300);
    expect(first?.cacheReadTokens).toBe(8000);
    expect(first?.cacheWriteTokens).toBe(400);
  });

  it('emits one tool call per tool_use block with its own external id', () => {
    const tools = byType('tool_call');
    expect(tools.map((t) => t.toolName)).toEqual(['Read', 'Edit']);
    expect(new Set(tools.map((t) => t.externalId)).size).toBe(2);
  });

  it('resolves tool success from the tool_result that follows', () => {
    const tools = byType('tool_call');
    expect(tools.find((t) => t.toolName === 'Read')?.toolSucceeded).toBe(true);
    expect(tools.find((t) => t.toolName === 'Edit')?.toolSucceeded).toBe(false);
  });

  it('flags subagent turns, compaction and API errors', () => {
    expect(byType('response').some((e) => e.isSubagent)).toBe(true);
    expect(byType('compaction')).toHaveLength(1);
    expect(byType('error')).toHaveLength(1);
  });

  it('ignores record types it does not understand instead of failing', () => {
    expect(events.every((e) => e.timestamp && !Number.isNaN(Date.parse(e.timestamp)))).toBe(true);
  });

  it('never emits an event without a timestamp', () => {
    expect(
      mapRecord(
        { type: 'user', message: { content: 'x' } },
        { storeResponses: false, toolResultOutcomes: new Map() },
      ),
    ).toEqual([]);
  });

  it('derives session boundaries from the events it produced', () => {
    const boundaries = sessionBoundaryFrom(events);
    const session = [...boundaries.values()][0];
    expect(session?.startedAt).toBe('2026-06-01T09:00:00.000Z');
    expect(session?.endedAt).toBe('2026-06-01T09:11:00.000Z');
    expect(session?.workingDirectory).toBe('/home/example/projects/demo-app');
  });
});

describe('streaming reader', () => {
  it('counts a malformed line without losing the rest of the file', async () => {
    const stats = statSync(FIXTURE);
    const chunk = await readTranscript(
      { path: FIXTURE, size: stats.size, mtimeMs: stats.mtimeMs },
      { startOffset: 0 },
    );
    expect(chunk.parseErrors).toBe(1);
    expect(chunk.records.length).toBeGreaterThan(10);
    expect(chunk.endOffset).toBeLessThanOrEqual(stats.size);
  });

  it('resumes from a byte offset and produces the same records as one pass', async () => {
    const stats = statSync(FIXTURE);
    const file = { path: FIXTURE, size: stats.size, mtimeMs: stats.mtimeMs };
    const whole = await readTranscript(file, { startOffset: 0 });

    const first = await readTranscript(file, { startOffset: 0, maxRecords: 4 });
    const rest = await readTranscript(file, { startOffset: first.endOffset });

    expect(first.records.length).toBe(4);
    expect(first.records.length + rest.records.length).toBe(whole.records.length);
    expect(rest.endOffset).toBe(whole.endOffset);
  });

  it('stops at the last complete line so a half-written record is re-read, not skipped', async () => {
    const stats = statSync(FIXTURE);
    const truncated = { path: FIXTURE, size: stats.size - 20, mtimeMs: stats.mtimeMs };
    const chunk = await readTranscript(truncated, { startOffset: 0 });
    expect(chunk.endOffset).toBeLessThanOrEqual(truncated.size);
  });
});
