import { Global, Module } from '@nestjs/common';
import { BusyState } from './busy.service';
import { IngestTokenGuard, LocalOriginGuard } from './guards';
import { RuntimeService } from './runtime.service';
import { StoreService } from './store.service';
import { IngestService } from '../ingest/ingest.service';

@Global()
@Module({
  providers: [
    RuntimeService,
    StoreService,
    BusyState,
    LocalOriginGuard,
    IngestTokenGuard,
    IngestService,
  ],
  exports: [
    RuntimeService,
    StoreService,
    BusyState,
    LocalOriginGuard,
    IngestTokenGuard,
    IngestService,
  ],
})
export class CommonModule {}
