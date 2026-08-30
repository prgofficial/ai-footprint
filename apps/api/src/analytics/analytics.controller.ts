import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  activityQuerySchema,
  promptSearchSchema,
  rangeQuerySchema,
  type RangeQuery,
} from '@ai-footprint/shared';
import { LocalOriginGuard, zodPipe } from '../common';
import { AnalyticsService } from './analytics.service';
import { InsightsService } from './insights.service';

type ActivityQuery = RangeQuery & { limit: number; cursor?: string; eventType?: string };
type PromptQuery = RangeQuery & { limit: number; cursor?: string; q?: string };

@Controller('api/analytics')
@UseGuards(LocalOriginGuard)
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly insights: InsightsService,
  ) {}

  @Get('overview')
  overview(@Query(zodPipe(rangeQuerySchema)) query: RangeQuery) {
    return this.analytics.overview(query);
  }

  @Get('timeseries')
  timeseries(@Query(zodPipe(rangeQuerySchema)) query: RangeQuery) {
    return this.analytics.timeseries(query);
  }

  @Get('providers')
  providers(@Query(zodPipe(rangeQuerySchema)) query: RangeQuery) {
    return this.analytics.providers(query);
  }

  @Get('models')
  models(@Query(zodPipe(rangeQuerySchema)) query: RangeQuery) {
    return this.analytics.models(query);
  }

  @Get('projects')
  projects(@Query(zodPipe(rangeQuerySchema)) query: RangeQuery) {
    return this.analytics.projects(query);
  }

  @Get('categories')
  categories(@Query(zodPipe(rangeQuerySchema)) query: RangeQuery) {
    return this.analytics.categories(query);
  }

  @Get('technologies')
  technologies(@Query(zodPipe(rangeQuerySchema)) query: RangeQuery) {
    return this.analytics.technologies(query);
  }

  @Get('activity')
  activity(@Query(zodPipe(activityQuerySchema)) query: ActivityQuery) {
    return this.analytics.activity(query);
  }

  @Get('prompts')
  prompts(@Query(zodPipe(promptSearchSchema)) query: PromptQuery) {
    return this.analytics.prompts(query);
  }

  @Get('prompts/analytics')
  promptAnalytics(@Query(zodPipe(rangeQuerySchema)) query: RangeQuery) {
    return this.analytics.promptAnalytics(query);
  }

  @Get('prompts/:id')
  promptDetail(@Param('id') id: string) {
    return this.analytics.promptDetail(id);
  }

  @Get('sessions')
  sessions(@Query(zodPipe(activityQuerySchema)) query: ActivityQuery) {
    return this.analytics.sessions(query);
  }

  @Get('sessions/:id')
  sessionDetail(@Param('id') id: string) {
    return this.analytics.sessionDetail(id);
  }

  @Get('insights')
  insightsList(@Query(zodPipe(rangeQuerySchema)) query: RangeQuery) {
    return this.insights.generate(query);
  }

  @Get('profile')
  profile(@Query(zodPipe(rangeQuerySchema)) query: RangeQuery) {
    return this.analytics.profile(query);
  }
}
