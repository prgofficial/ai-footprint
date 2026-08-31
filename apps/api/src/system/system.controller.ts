import { Controller, Get } from '@nestjs/common';
import {
  APP_NAME,
  type HealthResponse,
  type StorageResponse,
  type SystemConfigResponse,
} from '@ai-footprint/shared';
import { listBackups } from '@ai-footprint/database';
import { RuntimeService, StoreService } from '../common';
import { ProviderRegistry } from '../providers/provider.registry';

@Controller('api')
export class SystemController {
  constructor(
    private readonly runtime: RuntimeService,
    private readonly stores: StoreService,
    private readonly registry: ProviderRegistry,
  ) {}

  @Get('health')
  health(): HealthResponse {
    const { store, databasePath } = {
      store: this.stores.store,
      databasePath: this.stores.store.databasePath,
    };
    const size = store.maintenance.databaseSize(databasePath);
    let ok = true;
    try {
      store.events.countAll();
    } catch {
      ok = false;
    }
    return {
      status: ok ? 'ok' : 'degraded',
      version: this.runtime.version,
      uptimeMs: this.runtime.uptimeMs,
      db: { ok, sizeBytes: size.db + size.wal, path: databasePath },
    };
  }

  @Get('system/config')
  async config(): Promise<SystemConfigResponse> {
    const settings = this.stores.settings();
    return {
      name: APP_NAME,
      version: this.runtime.version,
      apiBaseUrl: '',
      mode: this.runtime.mode,
      dataDirectory: this.runtime.paths.root,
      hostDataDirectory: process.env.AI_FOOTPRINT_HOST_DATA ?? null,
      databasePath: this.stores.store.databasePath,
      timezone: settings.timezone,
      onboardingComplete: settings.onboardingComplete,
      capabilities: {
        hooks: true,
        export: true,
      },
      providers: await this.registry.summaries(),
    };
  }

  @Get('system/storage')
  storage(): StorageResponse {
    const store = this.stores.store;
    const size = store.maintenance.databaseSize(store.databasePath);
    return {
      databasePath: store.databasePath,
      databaseSizeBytes: size.db,
      walSizeBytes: size.wal,
      integrity: store.integrity(),
      tables: store.maintenance.tableCounts(),
      backups: listBackups(this.runtime.paths.backups),
      dataDirectory: this.runtime.paths.root,
    };
  }
}
