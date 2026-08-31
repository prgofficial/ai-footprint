import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { getLogger } from '@ai-footprint/config';
import {
  ClaudeCodeAdapter,
  installHooks,
  type AIProviderAdapter,
  type IngestContext,
  type Watermark,
} from '@ai-footprint/collectors';
import type { AIEventInput, BackfillProgress, ProviderSummary } from '@ai-footprint/shared';
import { BusyState, Conflict, NotFound, RuntimeService, StoreService } from '../common';
import { IngestService } from '../ingest/ingest.service';

interface RunningBackfill {
  controller: AbortController;
  promise: Promise<void>;
}

const AGGREGATE_FLUSH_MS = 20_000;

/** What a tool that posts its own events can do: everything the payload carries, nothing pulled. */
const PUSH_ONLY_CAPABILITIES: ProviderSummary['capabilities'] = {
  historicalBackfill: false,
  realtime: true,
  tokens: true,
  cost: true,
  responses: true,
  toolActivity: true,
};

function emptyProgress(providerId: string): BackfillProgress {
  return {
    providerId,
    state: 'idle',
    filesTotal: 0,
    filesDone: 0,
    bytesTotal: 0,
    bytesDone: 0,
    eventsIngested: 0,
    eventsDeduped: 0,
    parseErrors: 0,
  };
}

@Injectable()
export class ProviderRegistry implements OnModuleDestroy {
  private readonly logger = getLogger();
  private readonly adapters = new Map<string, AIProviderAdapter>();
  private readonly progressState = new Map<string, BackfillProgress>();
  private readonly running = new Map<string, RunningBackfill>();
  private readonly subscriptions = new Map<string, { close(): Promise<void> }>();
  readonly events = new EventEmitter();

  constructor(
    private readonly runtime: RuntimeService,
    private readonly stores: StoreService,
    private readonly ingest: IngestService,
    private readonly busy: BusyState,
  ) {
    this.register(new ClaudeCodeAdapter({ backupDir: this.runtime.paths.backups }));
  }

  register(adapter: AIProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
    this.stores.store.providers.register(adapter.id, adapter.name);
    this.progressState.set(adapter.id, emptyProgress(adapter.id));
  }

  get(id: string): AIProviderAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new NotFound(`The provider "${id}"`);
    return adapter;
  }

  list(): AIProviderAdapter[] {
    return [...this.adapters.values()];
  }

  context(providerId: string, source: string, deferAggregates = false): IngestContext {
    const store = this.stores.store;
    return {
      submit: async (events: AIEventInput[]) => {
        const result = await this.ingest.ingest(events, { providerId, source, deferAggregates });
        return { accepted: result.accepted, deduped: result.deduped };
      },
      progress: (update) => this.updateProgress(providerId, update),
      getWatermark: (sourcePath) => {
        const row = store.collectorState.get(providerId, sourcePath);
        if (!row) return null;
        return {
          byteOffset: row.byteOffset,
          size: row.size,
          mtimeMs: row.mtimeMs,
          contentHash: row.contentHash,
          lineCount: row.lineCount,
          parseErrors: row.parseErrors,
        };
      },
      setWatermark: (sourcePath, watermark: Watermark) => {
        store.collectorState.save({ providerId, sourcePath, ...watermark });
      },
      clearWatermarks: () => store.collectorState.clearProvider(providerId),
      settings: () => {
        const settings = this.stores.settings();
        return { storeResponses: settings.storeResponses, metadataOnly: settings.metadataOnly };
      },
      logger: this.logger,
    };
  }

  progress(providerId: string): BackfillProgress {
    return this.progressState.get(providerId) ?? emptyProgress(providerId);
  }

  private updateProgress(providerId: string, update: Partial<BackfillProgress>): void {
    const current = this.progress(providerId);
    const next = { ...current, ...update, providerId };
    this.progressState.set(providerId, next);
    this.events.emit(`progress:${providerId}`, next);
  }

  async detect(providerId: string) {
    return this.get(providerId).detect();
  }

  async connect(providerId: string, options: { backfill: boolean; installHooks: boolean }) {
    const adapter = this.get(providerId);
    const ctx = this.context(providerId, 'connect');
    const store = this.stores.store;

    store.providers.setStatus(providerId, 'connecting', null);
    const result = await adapter.connect(
      {
        ...options,
        apiPort: this.runtime.port,
        ingestToken: this.runtime.ingestToken,
      },
      ctx,
    );

    if (!result.connected) {
      store.providers.setStatus(providerId, 'error', result.message);
      return result;
    }

    store.providers.update(providerId, {
      status: 'connected',
      enabled: true,
      connectedAt: new Date().toISOString(),
      disconnectedAt: null,
      lastError: null,
      configJson: JSON.stringify({ hooksInstalled: options.installHooks }),
    });

    if (options.backfill && adapter.capabilities.historicalBackfill) {
      this.startBackfill(providerId);
    } else {
      await this.startWatch(providerId);
    }
    return result;
  }

  async disconnect(providerId: string): Promise<void> {
    const adapter = this.get(providerId);
    await this.cancelBackfill(providerId);
    await this.stopWatch(providerId);
    await adapter.disconnect(this.context(providerId, 'disconnect'));
    this.stores.store.providers.update(providerId, {
      status: 'disconnected',
      disconnectedAt: new Date().toISOString(),
      lastError: null,
    });
  }

  startBackfill(providerId: string): BackfillProgress {
    if (this.running.has(providerId)) {
      throw new Conflict('An import is already running for this provider.');
    }
    const adapter = this.get(providerId);
    const controller = new AbortController();
    const ctx = this.context(providerId, 'backfill', true);

    this.updateProgress(providerId, {
      ...emptyProgress(providerId),
      state: 'running',
      startedAt: new Date().toISOString(),
    });
    this.busy.beginImport(providerId);
    void this.stopWatch(providerId);

    const promise = (async () => {
      // Aggregates are flushed on a timer so a long import still shows moving numbers.
      const flush = setInterval(() => {
        if (this.ingest.hasPendingAggregates()) this.ingest.flushAggregates();
      }, AGGREGATE_FLUSH_MS);
      flush.unref?.();
      try {
        for await (const _ of adapter.backfill(ctx, controller.signal)) {
          // Progress is reported through the context; the yielded count is only a heartbeat.
        }
        this.ingest.flushAggregates();
      } catch (error) {
        this.logger.error({ providerId, err: error }, 'backfill failed');
        this.updateProgress(providerId, {
          state: 'error',
          message: 'The import stopped before it finished. Reconnect to try again.',
          finishedAt: new Date().toISOString(),
        });
        this.stores.store.providers.setStatus(providerId, 'connected', 'Import did not complete');
      } finally {
        clearInterval(flush);
        this.busy.endImport(providerId);
        this.ingest.flushAggregates();
        this.running.delete(providerId);
        await this.startWatch(providerId).catch(() => undefined);
      }
    })();

    this.running.set(providerId, { controller, promise });
    return this.progress(providerId);
  }

  async cancelBackfill(providerId: string): Promise<void> {
    const running = this.running.get(providerId);
    if (!running) return;
    running.controller.abort();
    await running.promise.catch(() => undefined);
    this.running.delete(providerId);
  }

  async startWatch(providerId: string): Promise<void> {
    const adapter = this.get(providerId);
    if (!adapter.capabilities.realtime) return;
    await this.stopWatch(providerId);
    const subscription = await adapter.watch(this.context(providerId, 'watch'));
    if (subscription) this.subscriptions.set(providerId, subscription);
  }

  async stopWatch(providerId: string): Promise<void> {
    const subscription = this.subscriptions.get(providerId);
    if (!subscription) return;
    this.subscriptions.delete(providerId);
    await subscription.close().catch(() => undefined);
  }

  /** Rewrites any hook this app installed so it points at the current port and token. */
  refreshInstalledHooks(): void {
    for (const adapter of this.adapters.values()) {
      if (!(adapter instanceof ClaudeCodeAdapter)) continue;
      if (!adapter.hooksAreInstalled()) continue;
      try {
        installHooks({
          settingsPath: adapter.locations.settingsPath,
          backupDir: this.runtime.paths.backups,
          port: this.runtime.port,
          token: this.runtime.ingestToken,
        });
        this.logger.info({ providerId: adapter.id, port: this.runtime.port }, 'hooks refreshed');
      } catch (error) {
        this.logger.warn({ providerId: adapter.id, err: error }, 'could not refresh hooks');
      }
    }
  }

  async resumeConnected(): Promise<void> {
    for (const record of this.stores.store.providers.list()) {
      if (record.status !== 'connected' || !record.enabled) continue;
      try {
        // G12: the app may have been down while Claude Code kept working. The reconcile
        // scan starts the watcher itself once it has caught up.
        this.startBackfill(record.id);
      } catch (error) {
        this.logger.warn({ providerId: record.id, err: error }, 'could not resume provider');
      }
    }
  }

  async summaries(): Promise<ProviderSummary[]> {
    const store = this.stores.store;
    const summaries: ProviderSummary[] = [];

    for (const adapter of this.adapters.values()) {
      const record = store.providers.get(adapter.id);
      const detection = await adapter.detect();
      const health = await adapter.health(this.context(adapter.id, 'health'));
      summaries.push({
        id: adapter.id,
        name: adapter.name,
        status: (record?.status as ProviderSummary['status']) ?? 'disconnected',
        enabled: record?.enabled ?? true,
        capabilities: adapter.capabilities,
        detected: detection.detected,
        detectionMessage: detection.message,
        connectedAt: record?.connectedAt ?? null,
        lastEventAt: record?.lastEventAt ?? null,
        eventCount: store.events.countForProvider(adapter.id),
        lastError: record?.lastError ?? null,
        health: { status: health.status, reason: health.reason },
        warnings: health.warnings,
      });
    }
    // Tools that push through the ingest endpoint have no adapter, so they were absent from
    // this list entirely: their data appeared on every chart while the source filter could not
    // select them, Settings listed one provider beside a storage count of seven, and there was
    // no way to pause them. They are reported for what they are: a push source, with no
    // detection or health to speak of.
    for (const record of store.providers.list()) {
      if (this.adapters.has(record.id)) continue;
      summaries.push({
        id: record.id,
        name: record.name,
        status: (record.status as ProviderSummary['status']) ?? 'connected',
        enabled: record.enabled,
        capabilities: PUSH_ONLY_CAPABILITIES,
        detected: true,
        detectionMessage: 'Sends its own events to AI Footprint.',
        connectedAt: record.connectedAt ?? null,
        lastEventAt: record.lastEventAt ?? null,
        eventCount: store.events.countForProvider(record.id),
        lastError: record.lastError ?? null,
        health: { status: 'ok' },
        warnings: [],
      });
    }

    return summaries;
  }

  setEnabled(providerId: string, enabled: boolean): void {
    // Not this.get(): a push source has no adapter, and pausing it must still work.
    if (!this.stores.store.providers.get(providerId))
      throw new NotFound(`The provider "${providerId}"`);
    this.stores.store.providers.update(providerId, { enabled });
    if (!enabled && this.adapters.has(providerId)) void this.stopWatch(providerId);
  }

  async onModuleDestroy(): Promise<void> {
    for (const providerId of this.adapters.keys()) {
      await this.cancelBackfill(providerId);
      await this.stopWatch(providerId);
    }
  }
}
