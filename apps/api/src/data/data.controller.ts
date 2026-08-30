import { Body, Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { deleteScopeSchema, exportQuerySchema, type DeletePreview } from '@ai-footprint/shared';
import type { DeleteScope, EventFilters } from '@ai-footprint/database';
import { LocalOriginGuard, StoreService, ValidationFailure, zodPipe } from '../common';
import { AnalyticsService } from '../analytics/analytics.service';
import { ExportService } from './export.service';

type ExportQuery = Parameters<typeof exportQuerySchema.parse>[0] extends never
  ? never
  : ReturnType<typeof exportQuerySchema.parse>;

const CONFIRMATION = 'DELETE';

@Controller('api/data')
@UseGuards(LocalOriginGuard)
export class DataController {
  constructor(
    private readonly stores: StoreService,
    private readonly analytics: AnalyticsService,
    private readonly exporter: ExportService,
  ) {}

  @Get('export')
  export(@Query(zodPipe(exportQuerySchema)) query: ExportQuery, @Res() response: Response): void {
    const scope = this.analytics.scope(query);
    const filters: EventFilters = scope.filters;
    const includePrompts = query.includePrompts && !this.stores.settings().metadataOnly;

    if (query.format === 'csv') {
      this.exporter.streamCsv(response, filters, includePrompts);
      return;
    }
    this.exporter.streamJson(response, filters, includePrompts, {
      range: query.range,
      from: scope.range.from,
      to: scope.range.to,
      providerId: query.providerId ?? null,
      projectId: query.projectId ?? null,
      category: query.category ?? null,
    });
  }

  @Post('delete/preview')
  preview(@Body(zodPipe(deleteScopeSchema)) body: unknown): DeletePreview {
    const scope = body as DeleteScope;
    const counts = this.stores.store.maintenance.preview(scope);
    return { scope: scope.scope, ...counts };
  }

  /** Brief §30: destructive actions need an exact preview and a typed confirmation. */
  @Post('delete')
  delete(@Body(zodPipe(deleteScopeSchema)) body: unknown): DeletePreview {
    const scope = body as DeleteScope & { confirm?: string };
    if (scope.confirm !== CONFIRMATION) {
      throw new ValidationFailure(`Type ${CONFIRMATION} to confirm this deletion.`);
    }
    const counts = this.stores.store.maintenance.execute(scope);
    this.stores.store.maintenance.vacuum();
    if (scope.scope !== 'prompts') this.stores.store.rollups.rebuildAll();
    return { scope: scope.scope, ...counts };
  }

  @Post('retention/apply')
  applyRetention(): { cleared: number } {
    const months = this.stores.settings().retentionMonths;
    return { cleared: this.stores.store.maintenance.applyRetention(months) };
  }
}
