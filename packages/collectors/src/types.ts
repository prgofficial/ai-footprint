import type {
  AIEventInput,
  BackfillProgress,
  DetectionResult,
  HealthStatus,
  ProviderCapabilities,
} from '@ai-footprint/shared';

export interface IngestContext {
  /** Returns how many rows were newly stored; adapters use it only for progress. */
  submit(events: AIEventInput[], source: string): Promise<{ accepted: number; deduped: number }>;
  progress(update: Partial<BackfillProgress>): void;
  getWatermark(sourcePath: string): Watermark | null;
  setWatermark(sourcePath: string, watermark: Watermark): void;
  clearWatermarks(): void;
  settings(): { storeResponses: boolean; metadataOnly: boolean };
  logger: {
    debug(obj: object, msg?: string): void;
    info(obj: object, msg?: string): void;
    warn(obj: object, msg?: string): void;
    error(obj: object, msg?: string): void;
  };
}

export interface Watermark {
  byteOffset: number;
  size: number;
  mtimeMs: number;
  contentHash: string | null;
  lineCount: number;
  parseErrors: number;
}

export interface ConnectOptions {
  backfill: boolean;
  installHooks: boolean;
  apiPort: number;
  ingestToken: string;
}

export interface ConnectionResult {
  connected: boolean;
  message: string;
  warnings: string[];
}

export interface ProviderHealth {
  status: HealthStatus;
  reason?: string;
  warnings: string[];
}

export interface Subscription {
  close(): Promise<void>;
}

/**
 * Plan §4.1. The brief's start()/stop() shape assumes every provider is a live stream;
 * transcript-based providers are pull-based, so backfill and watch are separate concerns
 * and capabilities are declared rather than assumed.
 */
export interface AIProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly capabilities: ProviderCapabilities;

  detect(): Promise<DetectionResult>;
  connect(options: ConnectOptions, ctx: IngestContext): Promise<ConnectionResult>;
  disconnect(ctx: IngestContext): Promise<void>;

  backfill(ctx: IngestContext, signal: AbortSignal): AsyncIterable<number>;
  watch(ctx: IngestContext): Promise<Subscription | null>;

  health(ctx: IngestContext): Promise<ProviderHealth>;
}
