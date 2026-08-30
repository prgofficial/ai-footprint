import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { mapHookPayload } from '@ai-footprint/collectors';
import {
  hookPayloadSchema,
  ingestBatchSchema,
  type IngestBatch,
  type IngestResult,
} from '@ai-footprint/shared';
import { IngestTokenGuard, LocalOriginGuard, zodPipe } from '../common';
import { IngestService } from './ingest.service';
import { ProviderRegistry } from '../providers/provider.registry';

@Controller('api/ingest')
@UseGuards(LocalOriginGuard, IngestTokenGuard)
export class IngestController {
  constructor(
    private readonly ingest: IngestService,
    private readonly registry: ProviderRegistry,
  ) {}

  @Post('events')
  async events(@Body(zodPipe(ingestBatchSchema)) body: unknown): Promise<IngestResult> {
    const batch = body as IngestBatch;
    return this.ingest.ingest(batch.events, { providerId: batch.providerId, source: 'api' });
  }

  /**
   * Claude Code's `UserPromptSubmit` hook blocks the user's turn and times out after 30 s,
   * so this returns immediately and never reports failure back into the editor.
   */
  @Post('hook')
  @HttpCode(200)
  async hook(@Body(zodPipe(hookPayloadSchema)) body: unknown): Promise<{ ok: true }> {
    const payload = body as ReturnType<typeof hookPayloadSchema.parse>;
    const event = mapHookPayload(payload);

    if (event) {
      void this.ingest
        .ingest([event], { providerId: event.providerId ?? 'claude-code', source: 'hook' })
        .catch(() => undefined);
    }

    // A hook is a nudge, not a data source: the transcript sweep is what carries the detail.
    void this.registry.startWatch('claude-code').catch(() => undefined);
    return { ok: true };
  }
}
