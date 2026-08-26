import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import { schemaMeta, settings } from '../schema';

export class SettingsRepository {
  constructor(private readonly db: AppDatabase) {}

  getAll(): Record<string, unknown> {
    const rows = this.db.select().from(settings).all();
    const out: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        out[row.key] = JSON.parse(row.valueJson);
      } catch {
        out[row.key] = null;
      }
    }
    return out;
  }

  get<T>(key: string, fallback: T): T {
    const row = this.db.select().from(settings).where(eq(settings.key, key)).get();
    if (!row) return fallback;
    try {
      return JSON.parse(row.valueJson) as T;
    } catch {
      return fallback;
    }
  }

  set(key: string, value: unknown): void {
    this.db
      .insert(settings)
      .values({ key, valueJson: JSON.stringify(value), updatedAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: settings.key,
        set: { valueJson: JSON.stringify(value), updatedAt: new Date().toISOString() },
      })
      .run();
  }

  setMany(values: Record<string, unknown>): void {
    this.db.transaction(() => {
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined) continue;
        this.set(key, value);
      }
    });
  }

  getMeta(key: string): string | null {
    return this.db.select().from(schemaMeta).where(eq(schemaMeta.key, key)).get()?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .insert(schemaMeta)
      .values({ key, value })
      .onConflictDoUpdate({ target: schemaMeta.key, set: { value } })
      .run();
  }
}
