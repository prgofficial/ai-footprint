import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  classifyOverrideSchema,
  settingsPatchSchema,
  CLASSIFIER_VERSION,
  type SettingsResponse,
  type TaskContext,
} from '@ai-footprint/shared';
import { LocalOriginGuard, NotFound, StoreService, zodPipe } from '../common';

@Controller('api')
@UseGuards(LocalOriginGuard)
export class SettingsController {
  constructor(private readonly stores: StoreService) {}

  @Get('settings')
  read(): SettingsResponse {
    return this.stores.settings();
  }

  @Patch('settings')
  update(@Body(zodPipe(settingsPatchSchema)) body: unknown): SettingsResponse {
    return this.stores.updateSettings(body as Partial<SettingsResponse>);
  }

  @Post('settings/onboarding-complete')
  completeOnboarding(): SettingsResponse {
    return this.stores.updateSettings({ onboardingComplete: true });
  }

  /** A user override always wins over the heuristic and is never recomputed (§6.2). */
  @Post('events/:id/classify')
  classify(@Param('id') id: string, @Body(zodPipe(classifyOverrideSchema)) body: unknown) {
    const payload = body as { category: string; contexts?: TaskContext[] };
    // Without this the insert trips a foreign key and answers 500 with the raw SQL message.
    if (!this.stores.store.events.exists(id)) throw new NotFound('That event');
    this.stores.store.enrichment.override(
      id,
      payload.category,
      payload.contexts ?? [],
      CLASSIFIER_VERSION,
    );
    return { ok: true };
  }
}
