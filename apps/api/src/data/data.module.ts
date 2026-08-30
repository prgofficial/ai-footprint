import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { DataController } from './data.controller';
import { ExportService } from './export.service';

@Module({
  imports: [AnalyticsModule],
  controllers: [DataController],
  providers: [ExportService],
})
export class DataModule {}
