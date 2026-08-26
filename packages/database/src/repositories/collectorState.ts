import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import { collectorState } from '../schema';

export type CollectorStateRecord = typeof collectorState.$inferSelect;

export class CollectorStateRepository {
  constructor(private readonly db: AppDatabase) {}

  get(providerId: string, sourcePath: string): CollectorStateRecord | undefined {
    return this.db
      .select()
      .from(collectorState)
      .where(
        and(eq(collectorState.providerId, providerId), eq(collectorState.sourcePath, sourcePath)),
      )
      .get();
  }

  listForProvider(providerId: string): CollectorStateRecord[] {
    return this.db
      .select()
      .from(collectorState)
      .where(eq(collectorState.providerId, providerId))
      .all();
  }

  save(record: Omit<CollectorStateRecord, 'lastScannedAt'> & { lastScannedAt?: string }): void {
    const value = { ...record, lastScannedAt: record.lastScannedAt ?? new Date().toISOString() };
    this.db
      .insert(collectorState)
      .values(value)
      .onConflictDoUpdate({
        target: [collectorState.providerId, collectorState.sourcePath],
        set: {
          byteOffset: value.byteOffset,
          size: value.size,
          mtimeMs: value.mtimeMs,
          contentHash: value.contentHash,
          lineCount: value.lineCount,
          parseErrors: value.parseErrors,
          lastScannedAt: value.lastScannedAt,
        },
      })
      .run();
  }

  clearProvider(providerId: string): void {
    this.db.delete(collectorState).where(eq(collectorState.providerId, providerId)).run();
  }
}
