import { Module } from '@nestjs/common';
import { ProviderRegistry } from './provider.registry';
import { ProvidersController } from './providers.controller';

@Module({
  controllers: [ProvidersController],
  providers: [ProviderRegistry],
  exports: [ProviderRegistry],
})
export class ProvidersModule {}
