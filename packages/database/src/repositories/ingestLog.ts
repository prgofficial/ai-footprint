import { desc } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import { ingestLog } from '../schema';

export type IngestLogRecord = typeof ingestLog.$inferSelect;

export class IngestLogRepository {
  constructor(private readonly db: AppDatabase) {}

  record(entry: Omit<IngestLogRecord, 'finishedAt'> & { finishedAt?: string | null }): void {
    this.db
      .insert(ingestLog)
      .values({ ...entry, finishedAt: entry.finishedAt ?? new Date().toISOString() })
      .onConflictDoNothing()
      .run();
  }

  recent(limit = 20): IngestLogRecord[] {
    return this.db.select().from(ingestLog).orderBy(desc(ingestLog.startedAt)).limit(limit).all();
  }
}
