import { existsSync, statSync, watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { claudeHome, isPathInside } from '@ai-footprint/config';
import type { AIEventInput, ProviderCapabilities } from '@ai-footprint/shared';
import type {
  AIProviderAdapter,
  ConnectOptions,
  ConnectionResult,
  IngestContext,
  ProviderHealth,
  Subscription,
} from '../../types';
import { claudeLocations, detectClaudeCode } from './detect';
import { DriftDetector } from './drift';
import { hooksInstalled, installHooks, readSettings, uninstallHooks } from './hooks';
import { applyToolOutcomes, mapRecord, PROVIDER_ID } from './mappers';
import {
  headHash,
  listTranscriptFiles,
  readTranscript,
  shouldRestart,
  type TranscriptFile,
} from './transcript-reader';

const CAPABILITIES: ProviderCapabilities = {
  historicalBackfill: true,
  realtime: true,
  tokens: true,
  cost: true,
  responses: true,
  toolActivity: true,
};

const RECORDS_PER_CHUNK = 2000;
const WATCH_DEBOUNCE_MS = 500;
const POLL_INTERVAL_MS = 5000;

export interface ClaudeCodeAdapterOptions {
  home?: string;
  backupDir: string;
}

export class ClaudeCodeAdapter implements AIProviderAdapter {
  readonly id = PROVIDER_ID;
  readonly name = 'Claude Code';
  readonly capabilities = CAPABILITIES;

  private readonly drift = new DriftDetector();
  private readonly home: string;
  private readonly backupDir: string;

  constructor(options: ClaudeCodeAdapterOptions) {
    this.home = options.home ?? claudeHome();
    this.backupDir = options.backupDir;
  }

  get locations() {
    return claudeLocations(this.home);
  }

  async detect() {
    return detectClaudeCode(this.home);
  }

  async connect(options: ConnectOptions, _ctx: IngestContext): Promise<ConnectionResult> {
    const detection = detectClaudeCode(this.home);
    if (!detection.detected) {
      return { connected: false, message: detection.message, warnings: [] };
    }

    const warnings: string[] = [];
    if (options.installHooks) {
      try {
        installHooks({
          settingsPath: this.locations.settingsPath,
          backupDir: this.backupDir,
          port: options.apiPort,
          token: options.ingestToken,
        });
      } catch (error) {
        warnings.push(
          error instanceof Error
            ? error.message
            : 'Realtime hooks could not be installed. Transcript import still works.',
        );
      }
    }

    return {
      connected: true,
      message: detection.message,
      warnings,
    };
  }

  async disconnect(_ctx: IngestContext): Promise<void> {
    uninstallHooks(this.locations.settingsPath, this.backupDir);
  }

  /**
   * Yields after every chunk so a 2 GB import never blocks the event loop or the API, and
   * so the caller can report progress and honour a cancellation between chunks.
   */
  async *backfill(ctx: IngestContext, signal: AbortSignal): AsyncIterable<number> {
    const files = listTranscriptFiles(this.locations.projectsDir);
    const bytesTotal = files.reduce((total, file) => total + file.size, 0);

    ctx.progress({
      state: 'running',
      filesTotal: files.length,
      filesDone: 0,
      bytesTotal,
      bytesDone: 0,
    });

    let filesDone = 0;
    let bytesDone = 0;
    let ingested = 0;
    let deduped = 0;
    let parseErrors = 0;

    for (const file of files) {
      if (signal.aborted) break;
      const scanned = await this.scanFile(file, ctx, signal, (accepted, skipped, errors, bytes) => {
        ingested += accepted;
        deduped += skipped;
        parseErrors += errors;
        bytesDone += bytes;
        ctx.progress({
          bytesDone,
          eventsIngested: ingested,
          eventsDeduped: deduped,
          parseErrors,
        });
      });
      filesDone += 1;
      bytesDone += Math.max(0, file.size - scanned.startOffset - scanned.consumed);
      ctx.progress({ filesDone, bytesDone });
      yield ingested;
    }

    for (const warning of this.drift.warnings())
      ctx.logger.warn({ reason: warning }, 'transcript drift');

    ctx.progress({
      state: signal.aborted ? 'cancelled' : 'done',
      filesDone,
      bytesDone: signal.aborted ? bytesDone : bytesTotal,
      eventsIngested: ingested,
      eventsDeduped: deduped,
      parseErrors,
      finishedAt: new Date().toISOString(),
    });
  }

  async scanFile(
    file: TranscriptFile,
    ctx: IngestContext,
    signal: AbortSignal,
    onChunk?: (accepted: number, deduped: number, parseErrors: number, bytes: number) => void,
  ): Promise<{ startOffset: number; consumed: number; accepted: number }> {
    if (!isPathInside(file.path, this.locations.projectsDir)) {
      return { startOffset: 0, consumed: 0, accepted: 0 };
    }

    const stored = ctx.getWatermark(file.path);
    const hash = await headHash(file.path);
    const restart = shouldRestart(stored, file, hash);
    const startOffset = restart ? 0 : (stored?.byteOffset ?? 0);

    let offset = startOffset;
    let lineCount = restart ? 0 : (stored?.lineCount ?? 0);
    let parseErrors = restart ? 0 : (stored?.parseErrors ?? 0);
    let accepted = 0;
    const settings = ctx.settings();
    const toolResultOutcomes = new Map<string, boolean>();

    while (offset < file.size && !signal.aborted) {
      const chunk = await readTranscript(file, {
        startOffset: offset,
        maxRecords: RECORDS_PER_CHUNK,
        signal,
      });
      if (chunk.bytesRead === 0) break;

      const events: AIEventInput[] = [];
      for (const record of chunk.records) {
        this.drift.observe(record);
        try {
          events.push(
            ...mapRecord(record, {
              storeResponses: settings.storeResponses && !settings.metadataOnly,
              toolResultOutcomes,
            }),
          );
        } catch {
          parseErrors += 1;
        }
      }

      applyToolOutcomes(events, toolResultOutcomes);
      const outcome =
        events.length > 0 ? await ctx.submit(events, file.path) : { accepted: 0, deduped: 0 };
      accepted += outcome.accepted;
      offset = chunk.endOffset;
      lineCount += chunk.linesRead;
      parseErrors += chunk.parseErrors;

      ctx.setWatermark(file.path, {
        byteOffset: offset,
        size: file.size,
        mtimeMs: file.mtimeMs,
        contentHash: hash,
        lineCount,
        parseErrors,
      });

      onChunk?.(outcome.accepted, outcome.deduped, chunk.parseErrors, chunk.bytesRead);
      if (!chunk.truncated) break;
    }

    return { startOffset, consumed: offset - startOffset, accepted };
  }

  /**
   * fs.watch is unreliable on network and virtualised mounts, so a slow poll runs alongside it.
   * The watch event names its file; the poll is the safety net and works newest-first.
   */
  async watch(ctx: IngestContext): Promise<Subscription | null> {
    const dir = this.locations.projectsDir;
    if (!existsSync(dir)) return null;

    let timer: NodeJS.Timeout | null = null;
    let sweeping = false;
    let closed = false;
    const controller = new AbortController();
    const pending = new Set<string>();
    const inFlight = new Set<string>();

    const scanOne = async (file: TranscriptFile): Promise<void> => {
      if (inFlight.has(file.path)) return;
      const stored = ctx.getWatermark(file.path);
      if (stored && stored.byteOffset >= file.size && stored.mtimeMs >= file.mtimeMs) return;
      inFlight.add(file.path);
      try {
        await this.scanFile(file, ctx, controller.signal);
      } finally {
        inFlight.delete(file.path);
      }
    };

    /**
     * Runs immediately and independently of the full sweep. On a first connect the sweep has
     * thousands of old transcripts to catch up on, and queueing live activity behind that
     * would make "realtime" mean minutes.
     */
    const scanNamed = async (): Promise<void> => {
      const paths = [...pending];
      pending.clear();
      for (const path of paths) {
        if (closed) return;
        try {
          const stats = statSync(path);
          await scanOne({ path, size: stats.size, mtimeMs: stats.mtimeMs });
        } catch {
          // The file was removed or is not readable; the sweep will notice if it returns.
        }
      }
    };

    const sweep = async (): Promise<void> => {
      if (sweeping || closed) return;
      sweeping = true;
      try {
        // Newest first, so recent activity is never queued behind years of history.
        for (const file of listTranscriptFiles(dir).reverse()) {
          if (closed) return;
          await scanOne(file);
        }
      } catch (error) {
        ctx.logger.warn({ err: error }, 'transcript watch sweep failed');
      } finally {
        sweeping = false;
      }
    };

    const schedule = (_event: string, filename: string | Buffer | null): void => {
      if (typeof filename !== 'string' || !filename.endsWith('.jsonl')) return;
      pending.add(join(dir, filename));
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void scanNamed(), WATCH_DEBOUNCE_MS);
    };

    let watcher: FSWatcher | null = null;
    try {
      watcher = watch(dir, { recursive: true }, schedule);
      watcher.on('error', () => {
        watcher?.close();
        watcher = null;
      });
    } catch {
      watcher = null;
    }

    const poll = setInterval(() => void sweep(), POLL_INTERVAL_MS);
    void sweep();

    return {
      close: async () => {
        closed = true;
        controller.abort();
        if (timer) clearTimeout(timer);
        clearInterval(poll);
        watcher?.close();
      },
    };
  }

  async health(_ctx: IngestContext): Promise<ProviderHealth> {
    const warnings = this.drift.warnings();
    if (!existsSync(this.locations.home)) {
      return {
        status: 'broken',
        reason: 'The Claude Code directory is no longer present on this machine.',
        warnings,
      };
    }
    if (!existsSync(this.locations.projectsDir)) {
      return {
        status: 'degraded',
        reason: 'Claude Code has not recorded any sessions yet.',
        warnings,
      };
    }
    return { status: warnings.length > 0 ? 'degraded' : 'ok', warnings };
  }

  hooksAreInstalled(): boolean {
    try {
      return hooksInstalled(readSettings(this.locations.settingsPath));
    } catch {
      return false;
    }
  }

  driftWarnings(): string[] {
    return this.drift.warnings();
  }
}
