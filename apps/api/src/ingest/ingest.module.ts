import { Module } from '@nestjs/common';
import { IngestController } from './ingest.controller';
import { ProvidersModule } from '../providers/providers.module';

@Module({
  imports: [ProvidersModule],
  controllers: [IngestController],
})
export class IngestModule {}
