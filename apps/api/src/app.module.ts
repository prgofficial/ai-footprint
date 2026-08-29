import { Module } from '@nestjs/common';
import { CommonModule } from './common';
import { AnalyticsModule } from './analytics/analytics.module';
import { DataModule } from './data/data.module';
import { EnrichmentModule } from './enrichment/enrichment.module';
import { IngestModule } from './ingest/ingest.module';
import { ProvidersModule } from './providers/providers.module';
import { SettingsModule } from './settings/settings.module';
import { SystemModule } from './system/system.module';

@Module({
  imports: [
    CommonModule,
    ProvidersModule,
    IngestModule,
    EnrichmentModule,
    AnalyticsModule,
    SettingsModule,
    DataModule,
    SystemModule,
  ],
})
export class AppModule {}
