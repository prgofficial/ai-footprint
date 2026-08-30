import { Body, Controller, Get, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  connectProviderSchema,
  type BackfillProgress,
  type DetectionResult,
  type ProviderSummary,
} from '@ai-footprint/shared';
import { LocalOriginGuard, zodPipe } from '../common';
import { ProviderRegistry } from './provider.registry';

@Controller('api/providers')
@UseGuards(LocalOriginGuard)
export class ProvidersController {
  constructor(private readonly registry: ProviderRegistry) {}

  @Get()
  async list(): Promise<ProviderSummary[]> {
    return this.registry.summaries();
  }

  @Get(':id/detect')
  async detect(@Param('id') id: string): Promise<DetectionResult> {
    return this.registry.detect(id);
  }

  @Post(':id/connect')
  async connect(@Param('id') id: string, @Body(zodPipe(connectProviderSchema)) body: unknown) {
    const options = body as { backfill: boolean; installHooks: boolean };
    const result = await this.registry.connect(id, options);
    return { ...result, progress: this.registry.progress(id) };
  }

  @Post(':id/disconnect')
  async disconnect(@Param('id') id: string): Promise<{ ok: true }> {
    await this.registry.disconnect(id);
    return { ok: true };
  }

  @Post(':id/backfill')
  backfill(@Param('id') id: string): BackfillProgress {
    return this.registry.startBackfill(id);
  }

  @Post(':id/backfill/cancel')
  async cancel(@Param('id') id: string): Promise<{ ok: true }> {
    await this.registry.cancelBackfill(id);
    return { ok: true };
  }

  @Post(':id/enable')
  enable(@Param('id') id: string): { ok: true } {
    this.registry.setEnabled(id, true);
    return { ok: true };
  }

  @Post(':id/disable')
  disable(@Param('id') id: string): { ok: true } {
    this.registry.setEnabled(id, false);
    return { ok: true };
  }

  @Get(':id/health')
  async health(@Param('id') id: string) {
    const adapter = this.registry.get(id);
    return adapter.health(this.registry.context(id, 'health'));
  }

  /** Server-sent events so the wizard can show a 2 GB import moving without polling. */
  @Get(':id/progress')
  progress(@Param('id') id: string, @Res() response: Response): void {
    this.registry.get(id);
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (progress: BackfillProgress): void => {
      response.write(`data: ${JSON.stringify(progress)}\n\n`);
    };

    send(this.registry.progress(id));
    const channel = `progress:${id}`;
    this.registry.events.on(channel, send);

    const keepAlive = setInterval(() => response.write(': keep-alive\n\n'), 15_000);
    response.on('close', () => {
      clearInterval(keepAlive);
      this.registry.events.off(channel, send);
      response.end();
    });
  }
}
