import type { ModelFamily } from '@ai-footprint/shared';

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion: number;
  cacheWritePerMillion: number;
}

/**
 * G11: cost is the metric users actually feel, but AI Footprint makes no network calls, so
 * the table is local, versioned and explicitly approximate. Every surface labels the result
 * "estimated", and an unknown model yields null rather than a guess.
 */
const TABLE: Partial<Record<ModelFamily, ModelPricing>> = {
  opus: {
    inputPerMillion: 15,
    outputPerMillion: 75,
    cacheReadPerMillion: 1.5,
    cacheWritePerMillion: 18.75,
  },
  sonnet: {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.3,
    cacheWritePerMillion: 3.75,
  },
  haiku: {
    inputPerMillion: 0.8,
    outputPerMillion: 4,
    cacheReadPerMillion: 0.08,
    cacheWritePerMillion: 1,
  },
};

export interface TokenUsage {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
}

export function estimateCostUsd(
  modelFamily: ModelFamily | null | undefined,
  usage: TokenUsage,
): number | null {
  if (!modelFamily) return null;
  const pricing = TABLE[modelFamily];
  if (!pricing) return null;

  const cost =
    ((usage.inputTokens ?? 0) * pricing.inputPerMillion +
      (usage.outputTokens ?? 0) * pricing.outputPerMillion +
      (usage.cacheReadTokens ?? 0) * pricing.cacheReadPerMillion +
      (usage.cacheWriteTokens ?? 0) * pricing.cacheWritePerMillion) /
    1_000_000;

  if (!Number.isFinite(cost) || cost <= 0) return null;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
