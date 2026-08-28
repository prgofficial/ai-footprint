import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import type { Watermark } from '../../types';
import type { TranscriptRecord } from './records';

export interface TranscriptFile {
  path: string;
  size: number;
  mtimeMs: number;
}

const MAX_SCAN_DEPTH = 6;

/** Sessions are not always one level deep: subagent and resumed sessions nest under their
 *  own directories, so the whole tree is walked. */
export function listTranscriptFiles(projectsDir: string): TranscriptFile[] {
  if (!existsSync(projectsDir)) return [];
  const files: TranscriptFile[] = [];

  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_SCAN_DEPTH) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      try {
        const stats = statSync(path);
        files.push({ path, size: stats.size, mtimeMs: stats.mtimeMs });
      } catch {
        // File vanished between readdir and stat; nothing to read.
      }
    }
  };

  walk(projectsDir, 0);
  return files.sort((a, b) => a.mtimeMs - b.mtimeMs);
}

/**
 * The first bytes of a transcript never change while it is appended to, so hashing them is
 * enough to tell an append apart from a rewrite or truncation, which is what makes the
 * byte-offset watermark safe to resume from.
 */
export async function headHash(path: string, bytes = 4096): Promise<string | null> {
  try {
    const handle = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(bytes);
      const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
      return createHash('sha256').update(buffer.subarray(0, bytesRead)).digest('hex');
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

export function shouldRestart(
  watermark: Watermark | null,
  file: TranscriptFile,
  hash: string | null,
): boolean {
  if (!watermark) return true;
  if (file.size < watermark.byteOffset) return true;
  if (watermark.contentHash && hash && watermark.contentHash !== hash) return true;
  return false;
}

export interface ReadResult {
  records: TranscriptRecord[];
  bytesRead: number;
  endOffset: number;
  linesRead: number;
  parseErrors: number;
  truncated: boolean;
}

export interface ReadOptions {
  startOffset: number;
  maxRecords?: number;
  signal?: AbortSignal;
}

/**
 * Streams from a byte offset: transcripts here reach 300 MB, so readFile is out. Consumes only
 * up to the last newline, so a half-written line is re-read next pass. A malformed line
 * increments a counter and the scan continues.
 */
export async function readTranscript(
  file: TranscriptFile,
  options: ReadOptions,
): Promise<ReadResult> {
  const result: ReadResult = {
    records: [],
    bytesRead: 0,
    endOffset: options.startOffset,
    linesRead: 0,
    parseErrors: 0,
    truncated: false,
  };

  if (options.startOffset >= file.size) return result;

  const maxRecords = options.maxRecords ?? Number.POSITIVE_INFINITY;
  const stream = createReadStream(file.path, {
    start: options.startOffset,
    end: file.size - 1,
    highWaterMark: 1 << 20,
  });

  let pending: Buffer = Buffer.alloc(0);
  let consumed = 0;

  const consumeLine = (line: Buffer): boolean => {
    result.linesRead += 1;
    const text = line.toString('utf8').trim();
    if (text.length > 0) {
      try {
        result.records.push(JSON.parse(text) as TranscriptRecord);
      } catch {
        result.parseErrors += 1;
      }
    }
    return result.records.length >= maxRecords;
  };

  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      pending = pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([pending, chunk]);

      let newlineIndex = pending.indexOf(0x0a);
      while (newlineIndex >= 0) {
        const line = pending.subarray(0, newlineIndex);
        consumed += newlineIndex + 1;
        pending = pending.subarray(newlineIndex + 1);
        if (consumeLine(line)) {
          result.truncated = true;
          break;
        }
        newlineIndex = pending.indexOf(0x0a);
      }

      if (result.truncated || options.signal?.aborted) {
        result.truncated = true;
        break;
      }
    }
  } finally {
    stream.destroy();
  }

  result.bytesRead = consumed;
  result.endOffset = options.startOffset + consumed;
  return result;
}
