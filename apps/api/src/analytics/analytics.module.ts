import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { InsightsService } from './insights.service';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, InsightsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
