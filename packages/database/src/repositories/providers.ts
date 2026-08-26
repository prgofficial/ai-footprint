import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import { providers } from '../schema';

export type ProviderRecord = typeof providers.$inferSelect;

export class ProviderRepository {
  constructor(private readonly db: AppDatabase) {}

  list(): ProviderRecord[] {
    return this.db.select().from(providers).all();
  }

  get(id: string): ProviderRecord | undefined {
    return this.db.select().from(providers).where(eq(providers.id, id)).get();
  }

  register(id: string, name: string): ProviderRecord {
    const existing = this.get(id);
    if (existing) return existing;
    const now = new Date().toISOString();
    this.db
      .insert(providers)
      .values({ id, name, status: 'disconnected', enabled: true, createdAt: now, updatedAt: now })
      .onConflictDoNothing()
      .run();
    return this.get(id) as ProviderRecord;
  }

  update(id: string, patch: Partial<Omit<ProviderRecord, 'id' | 'createdAt'>>): void {
    this.db
      .update(providers)
      .set({ ...patch, updatedAt: new Date().toISOString() })
      .where(eq(providers.id, id))
      .run();
  }

  setStatus(id: string, status: string, error?: string | null): void {
    this.update(id, { status, lastError: error ?? null });
  }

  touchLastEvent(id: string, timestamp: string): void {
    const current = this.get(id);
    if (!current || !current.lastEventAt || current.lastEventAt < timestamp) {
      this.update(id, { lastEventAt: timestamp });
    }
  }
}
