import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { getLogger } from '@ai-footprint/config';
import { createStore, type Store } from '@ai-footprint/database';
import {
  CLASSIFIER_VERSION,
  DEFAULT_IDLE_TIMEOUT_MS,
  ENRICHMENT_VERSION,
  type SettingsResponse,
} from '@ai-footprint/shared';
import { RuntimeService } from './runtime.service';

export const SETTING_DEFAULTS: SettingsResponse = {
  redactSecrets: true,
  metadataOnly: false,
  storeResponses: false,
  timezone: '',
  idleTimeoutMinutes: DEFAULT_IDLE_TIMEOUT_MS / 60_000,
  scanManifests: false,
  otlpEnabled: false,
  retentionMonths: 0,
  onboardingComplete: false,
};

@Injectable()
export class StoreService implements OnModuleDestroy {
  readonly store: Store;

  constructor(private readonly runtime: RuntimeService) {
    // A bind-mounted database on a virtualised filesystem cannot be trusted with WAL,
    // so the containerised path falls back to a rollback journal (plan §2.2).
    const journalMode = runtime.mode === 'docker' ? 'TRUNCATE' : 'WAL';
    this.store = createStore({ paths: runtime.paths, journalMode });

    const applied = this.store.migration.applied;
    if (applied.length > 0) {
      getLogger().info({ count: applied.length }, 'database migrations applied');
    }
    this.store.settings.setMeta('classifierVersion', String(CLASSIFIER_VERSION));
    this.store.settings.setMeta('enrichmentVersion', String(ENRICHMENT_VERSION));
  }

  settings(): SettingsResponse {
    const stored = this.store.settings.getAll();
    const merged = { ...SETTING_DEFAULTS, ...stored } as SettingsResponse;
    if (!merged.timezone) merged.timezone = this.runtime.timezoneFallback();
    return merged;
  }

  updateSettings(patch: Partial<SettingsResponse>): SettingsResponse {
    this.store.settings.setMany(patch as Record<string, unknown>);
    return this.settings();
  }

  onModuleDestroy(): void {
    this.store.close();
  }
}
