import { Injectable } from '@nestjs/common';
import { getLogger } from '@ai-footprint/config';
import { normalize, ProjectResolver, type NormalizeOptions } from '@ai-footprint/collectors';
import { offsetMinutesFor, type IngestRecord } from '@ai-footprint/database';
import {
  ACTIVE_TIME_TAIL_ALLOWANCE_MS,
  aiEventInputSchema,
  INGEST_BATCH_SIZE,
  ulid,
  type AIEventInput,
  type IngestResult,
} from '@ai-footprint/shared';
import { createHash } from 'node:crypto';
import { StoreService } from '../common/store.service';

export interface IngestOptions {
  providerId: string;
  source: string;
  /**
   * Session metrics and daily rollups are derived aggregates. Recomputing them after every
   * chunk of a multi-gigabyte import costs far more than the inserts themselves, so a
   * backfill accumulates what it touched and flushes once the pressure is off.
   */
  deferAggregates?: boolean;
}

function sessionRowId(providerId: string, externalSessionId: string): string {
  return createHash('sha256')
    .update(`${providerId}|${externalSessionId}`)
    .digest('hex')
    .slice(0, 24);
}

@Injectable()
export class IngestService {
  private readonly logger = getLogger();
  private readonly pendingSessions = new Set<string>();
  private readonly pendingDays = new Map<string, { day: string; providerId: string }>();

  constructor(private readonly stores: StoreService) {}

  /** Applies every aggregate a deferred ingest accumulated. Safe to call at any time. */
  flushAggregates(): { sessions: number; days: number } {
    const store = this.stores.store;
    const settings = this.stores.settings();
    const sessions = [...this.pendingSessions];
    const days = [...this.pendingDays.values()];
    this.pendingSessions.clear();
    this.pendingDays.clear();

    if (sessions.length > 0) {
      store.sessions.recomputeMetrics(
        sessions,
        settings.idleTimeoutMinutes * 60_000,
        ACTIVE_TIME_TAIL_ALLOWANCE_MS,
      );
    }
    if (days.length > 0) store.rollups.rebuild(days);
    return { sessions: sessions.length, days: days.length };
  }

  hasPendingAggregates(): boolean {
    return this.pendingSessions.size > 0 || this.pendingDays.size > 0;
  }

  /**
   * The one path into the database. Backfill, the realtime watch, hooks and the ingest
   * endpoint all funnel through here, so idempotency, redaction, project inference and
   * rollup maintenance can never be bypassed.
   */
  async ingest(events: AIEventInput[], options: IngestOptions): Promise<IngestResult> {
    const store = this.stores.store;
    const settings = this.stores.settings();
    const batchId = ulid();
    const startedAt = new Date().toISOString();

    const resolver = new ProjectResolver();
    const sessionsSeen = new Map<
      string,
      {
        externalId: string;
        providerId: string;
        projectId: string | null;
        startedAt: string;
        endedAt: string;
        model: string | null;
      }
    >();
    const defaultOffset = offsetMinutesFor(settings.timezone);

    const normalizeOptions: NormalizeOptions = {
      redactSecrets: settings.redactSecrets,
      metadataOnly: settings.metadataOnly,
      storeResponses: settings.storeResponses,
      defaultTzOffsetMinutes: defaultOffset,
      projectIdFor: (cwd) => resolver.resolve(cwd)?.id ?? null,
      sessionIdFor: (providerId, externalSessionId) =>
        externalSessionId ? sessionRowId(providerId, externalSessionId) : null,
    };

    const records: IngestRecord[] = [];
    let failed = 0;

    for (const raw of events) {
      const parsed = aiEventInputSchema.safeParse({
        ...raw,
        providerId: raw.providerId ?? options.providerId,
      });
      if (!parsed.success) {
        failed += 1;
        continue;
      }
      let record: IngestRecord;
      try {
        record = normalize({ ...parsed.data, providerId: options.providerId }, normalizeOptions);
      } catch {
        failed += 1;
        continue;
      }
      records.push(record);

      if (parsed.data.sessionId && record.event.sessionId) {
        const key = record.event.sessionId;
        const existing = sessionsSeen.get(key);
        if (!existing) {
          sessionsSeen.set(key, {
            externalId: parsed.data.sessionId,
            providerId: record.event.providerId,
            projectId: record.event.projectId,
            startedAt: record.event.timestamp,
            endedAt: record.event.timestamp,
            model: record.event.model,
          });
        } else {
          if (record.event.timestamp < existing.startedAt)
            existing.startedAt = record.event.timestamp;
          if (record.event.timestamp > existing.endedAt) existing.endedAt = record.event.timestamp;
          if (!existing.projectId) existing.projectId = record.event.projectId;
          if (!existing.model) existing.model = record.event.model;
        }
      }
    }

    const projects = resolver.drain();
    if (projects.length > 0) {
      const seenAt = new Date().toISOString();
      store.projects.upsertMany(
        projects.map((project) => ({
          id: project.id,
          path: project.path,
          name: project.name,
          repository: project.repository,
          gitRemote: project.gitRemote,
          seenAt,
        })),
      );
    }

    if (sessionsSeen.size > 0) {
      store.sessions.upsertMany(
        [...sessionsSeen.entries()].map(([id, session]) => ({
          id,
          providerId: session.providerId,
          externalId: session.externalId,
          projectId: session.projectId,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          primaryModel: session.model,
          endReason: null,
        })),
      );
    }

    let accepted = 0;
    let deduped = 0;
    const touchedDays = new Map<string, { day: string; providerId: string }>();

    for (let i = 0; i < records.length; i += INGEST_BATCH_SIZE) {
      const outcome = store.events.ingestBatch(records.slice(i, i + INGEST_BATCH_SIZE));
      accepted += outcome.accepted;
      deduped += outcome.deduped;
      failed += outcome.failed;
      for (const day of outcome.touchedDays) touchedDays.set(`${day.day}|${day.providerId}`, day);
    }

    if (options.deferAggregates) {
      for (const sessionId of sessionsSeen.keys()) this.pendingSessions.add(sessionId);
      for (const [key, day] of touchedDays) this.pendingDays.set(key, day);
    } else {
      if (sessionsSeen.size > 0) {
        store.sessions.recomputeMetrics(
          [...sessionsSeen.keys()],
          settings.idleTimeoutMinutes * 60_000,
          ACTIVE_TIME_TAIL_ALLOWANCE_MS,
        );
      }
      if (touchedDays.size > 0) store.rollups.rebuild([...touchedDays.values()]);
    }

    if (accepted > 0) {
      const latest = records.reduce(
        (max, record) => (record.event.timestamp > max ? record.event.timestamp : max),
        '',
      );
      if (latest) store.providers.touchLastEvent(options.providerId, latest);
    }

    store.ingestLog.record({
      batchId,
      providerId: options.providerId,
      source: options.source,
      accepted,
      deduped,
      failed,
      parseErrors: 0,
      startedAt,
    });

    this.logger.debug(
      { providerId: options.providerId, source: options.source, accepted, deduped, failed },
      'ingest batch complete',
    );

    return { accepted, deduped, failed, batchId };
  }
}
