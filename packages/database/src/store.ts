import { getAppPaths, type AppPaths } from '@ai-footprint/config';
import {
  checkpointAndClose,
  createDatabase,
  integrityCheck,
  openSqlite,
  type AppDatabase,
  type SqliteConnection,
} from './client';
import { migrate, type MigrateResult } from './migrator';
import {
  CollectorStateRepository,
  EnrichmentRepository,
  EventRepository,
  IngestLogRepository,
  MaintenanceRepository,
  ProjectRepository,
  ProviderRepository,
  RollupReadRepository,
  RollupRepository,
  SessionRepository,
  SettingsRepository,
} from './repositories';
import { AnalyticsRepository } from './repositories/analytics';
import { PromptRepository } from './repositories/prompts';

export interface StoreOptions {
  databasePath?: string;
  paths?: AppPaths;
  journalMode?: 'WAL' | 'DELETE' | 'TRUNCATE';
  runMigrations?: boolean;
}

export class Store {
  readonly connection: SqliteConnection;
  readonly db: AppDatabase;
  readonly databasePath: string;
  readonly migration: MigrateResult;

  readonly providers: ProviderRepository;
  readonly projects: ProjectRepository;
  readonly sessions: SessionRepository;
  readonly events: EventRepository;
  readonly prompts: PromptRepository;
  readonly analytics: AnalyticsRepository;
  readonly rollups: RollupRepository;
  readonly rollupReads: RollupReadRepository;
  readonly enrichment: EnrichmentRepository;
  readonly collectorState: CollectorStateRepository;
  readonly ingestLog: IngestLogRepository;
  readonly settings: SettingsRepository;
  readonly maintenance: MaintenanceRepository;

  constructor(options: StoreOptions = {}) {
    const paths = options.paths ?? getAppPaths();
    this.databasePath = options.databasePath ?? paths.database;
    this.connection = openSqlite({
      path: this.databasePath,
      journalMode: options.journalMode ?? 'WAL',
    });
    // Everything past the open has to give the handle back if it throws. A Store whose
    // constructor fails is never returned, so nobody can close it, and on Windows an open
    // handle keeps the file locked, so the database can then be neither deleted nor reopened
    // until the process exits. A tampered migration row is exactly that path.
    try {
      this.db = createDatabase(this.connection);

      this.migration =
        options.runMigrations === false
          ? { applied: [], alreadyApplied: 0, backupPath: null }
          : migrate(this.connection, {
              databasePath: this.databasePath === ':memory:' ? undefined : this.databasePath,
              backupDir: paths.backups,
            });

      this.providers = new ProviderRepository(this.db);
      this.projects = new ProjectRepository(this.db);
      this.sessions = new SessionRepository(this.db, this.connection);
      this.events = new EventRepository(this.connection);
      this.prompts = new PromptRepository(this.connection);
      this.analytics = new AnalyticsRepository(this.connection);
      this.rollups = new RollupRepository(this.connection);
      this.rollupReads = new RollupReadRepository(this.connection);
      this.enrichment = new EnrichmentRepository(this.connection);
      this.collectorState = new CollectorStateRepository(this.db);
      this.ingestLog = new IngestLogRepository(this.db);
      this.settings = new SettingsRepository(this.db);
      this.maintenance = new MaintenanceRepository(this.connection);
    } catch (error) {
      checkpointAndClose(this.connection);
      throw error;
    }
  }

  integrity(): 'ok' | 'failed' {
    return integrityCheck(this.connection);
  }

  close(): void {
    checkpointAndClose(this.connection);
  }
}

export function createStore(options: StoreOptions = {}): Store {
  return new Store(options);
}
