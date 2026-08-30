import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CLASSIFIER_VERSION, ENRICHMENT_VERSION } from '@ai-footprint/shared';
import { LocalOriginGuard, StoreService } from '../common';
import { EnrichmentService } from './enrichment.service';

@Controller('api/enrichment')
@UseGuards(LocalOriginGuard)
export class EnrichmentController {
  constructor(
    private readonly enrichment: EnrichmentService,
    private readonly stores: StoreService,
  ) {}

  @Get('status')
  status(): { pending: number; enrichmentVersion: number; classifierVersion: number } {
    return {
      pending: this.enrichment.pending(),
      enrichmentVersion: ENRICHMENT_VERSION,
      classifierVersion: CLASSIFIER_VERSION,
    };
  }

  @Post('run')
  async run(): Promise<{ processed: number; pending: number }> {
    const processed = await this.enrichment.runUntilDrained();
    return { processed, pending: this.enrichment.pending() };
  }

  @Post('reprocess')
  async reprocess(): Promise<{ pending: number }> {
    this.stores.store.enrichment.resetVersions();
    void this.enrichment.runUntilDrained();
    return { pending: this.enrichment.pending() };
  }
}
