import { Global, Module } from '@nestjs/common';
import { EnrichmentController } from './enrichment.controller';
import { EnrichmentService } from './enrichment.service';

@Global()
@Module({
  controllers: [EnrichmentController],
  providers: [EnrichmentService],
  exports: [EnrichmentService],
})
export class EnrichmentModule {}
