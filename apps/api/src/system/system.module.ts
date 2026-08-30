import { Module } from '@nestjs/common';
import { SystemController } from './system.controller';
import { ProvidersModule } from '../providers/providers.module';

@Module({
  imports: [ProvidersModule],
  controllers: [SystemController],
})
export class SystemModule {}
