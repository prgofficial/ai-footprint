import { eq, sql } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import { projects } from '../schema';

export type ProjectRecord = typeof projects.$inferSelect;

export interface ProjectUpsert {
  id: string;
  path: string | null;
  name: string;
  repository: string | null;
  gitRemote: string | null;
  seenAt: string;
}

export class ProjectRepository {
  constructor(private readonly db: AppDatabase) {}

  list(): ProjectRecord[] {
    return this.db.select().from(projects).orderBy(projects.name).all();
  }

  get(id: string): ProjectRecord | undefined {
    return this.db.select().from(projects).where(eq(projects.id, id)).get();
  }

  upsertMany(records: ProjectUpsert[]): void {
    if (records.length === 0) return;
    this.db.transaction((tx) => {
      for (const record of records) {
        tx.insert(projects)
          .values({
            id: record.id,
            path: record.path,
            name: record.name,
            repository: record.repository,
            gitRemote: record.gitRemote,
            firstSeenAt: record.seenAt,
            lastSeenAt: record.seenAt,
          })
          .onConflictDoUpdate({
            target: projects.id,
            set: {
              name: sql`excluded.name`,
              repository: sql`COALESCE(excluded.repository, ${projects.repository})`,
              gitRemote: sql`COALESCE(excluded.git_remote, ${projects.gitRemote})`,
              firstSeenAt: sql`MIN(excluded.first_seen_at, ${projects.firstSeenAt})`,
              lastSeenAt: sql`MAX(excluded.last_seen_at, ${projects.lastSeenAt})`,
            },
          })
          .run();
      }
    });
  }

  setTechProfile(id: string, profile: string[]): void {
    this.db
      .update(projects)
      .set({ techProfileJson: JSON.stringify(profile) })
      .where(eq(projects.id, id))
      .run();
  }
}
