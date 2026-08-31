import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { getLogger } from '@ai-footprint/config';
import { createStore, type Store } from '@ai-footprint/database';
import {
  ACTIVE_TIME_TAIL_ALLOWANCE_MS,
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

    // A migration that changes what the rollups summarise empties them rather than trying to
    // re-aggregate in SQL. Rebuilding before the first request is served costs a second or two
    // once, where serving zeroes would look like data loss. Measured at 1.5s over 323k events.
    if (this.store.rollups.needsRebuild()) {
      const startedAt = Date.now();
      const days = this.store.rollups.rebuildAll(
        this.settings().idleTimeoutMinutes * 60_000,
        ACTIVE_TIME_TAIL_ALLOWANCE_MS,
      );
      getLogger().info({ days, ms: Date.now() - startedAt }, 'analytics rollups rebuilt');
    }
  }

  settings(): SettingsResponse {
    const stored = this.store.settings.getAll();
    const merged = { ...SETTING_DEFAULTS, ...stored } as SettingsResponse;
    if (!merged.timezone) merged.timezone = this.runtime.timezoneFallback();
    return merged;
  }

  updateSettings(patch: Partial<SettingsResponse>): SettingsResponse {
    const before = this.settings();
    this.store.settings.setMany(patch as Record<string, unknown>);
    const after = this.settings();

    // `daily_active` is materialised with whatever idle timeout was in force when it was
    // built, while short ranges recompute live. Without this, changing the setting the docs
    // invite you to change left long ranges frozen on the old rule for ever, to the point
    // where a 30-day range reported less active time than the 7 days inside it.
    if (after.idleTimeoutMinutes !== before.idleTimeoutMinutes) {
      const startedAt = Date.now();
      const days = this.store.rollups.rebuildAll(
        after.idleTimeoutMinutes * 60_000,
        ACTIVE_TIME_TAIL_ALLOWANCE_MS,
      );
      getLogger().info(
        { days, ms: Date.now() - startedAt, idleTimeoutMinutes: after.idleTimeoutMinutes },
        'idle timeout changed, active time re-materialised',
      );
    }
    return after;
  }

  onModuleDestroy(): void {
    this.store.close();
  }
}
