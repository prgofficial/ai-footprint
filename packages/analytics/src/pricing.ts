export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion: number;
  /** Prompt caching bills a 5-minute write at 1.25x input and a 1-hour write at 2x. */
  cacheWrite5mPerMillion: number;
  cacheWrite1hPerMillion: number;
}

/**
 * Bumped whenever a rate changes, so a figure can say which card it was computed against.
 */
export const PRICING_VERSION = 2;
/** The date the rates below were read from Anthropic's published price list. */
export const PRICING_AS_OF = '2026-09-01';

function rates(input: number, output: number): ModelPricing {
  return {
    inputPerMillion: input,
    outputPerMillion: output,
    cacheReadPerMillion: input * 0.1,
    cacheWrite5mPerMillion: input * 1.25,
    cacheWrite1hPerMillion: input * 2,
  };
}

/**
 * Local, versioned and approximate, because nothing here makes a network call. An unknown model
 * yields null rather than a guess.
 *
 * Keyed on model, NOT on family: Opus 4.1 is $15/$75 and Opus 4.5 onwards is $5/$25, so a
 * family key overstated this machine's history threefold. Longest matching prefix wins, so a
 * dated id resolves to its family version and a new model resolves to nothing.
 * Rates: https://platform.claude.com/docs/en/about-claude/pricing
 */
const TABLE: ReadonlyArray<readonly [string, ModelPricing]> = [
  // Anthropic, the premium tier
  ['claude-fable-5', rates(10, 50)],
  ['claude-mythos-5', rates(10, 50)],
  // Opus 4.5 and later
  ['claude-opus-5', rates(5, 25)],
  ['claude-opus-4-8', rates(5, 25)],
  ['claude-opus-4-7', rates(5, 25)],
  ['claude-opus-4-6', rates(5, 25)],
  ['claude-opus-4-5', rates(5, 25)],
  // Opus 4.1 and 4, retired and three times the price of what replaced them
  ['claude-opus-4-1', rates(15, 75)],
  ['claude-opus-4', rates(15, 75)],
  // Sonnet
  ['claude-sonnet-5', rates(2, 10)],
  ['claude-sonnet-4-6', rates(3, 15)],
  ['claude-sonnet-4-5', rates(3, 15)],
  ['claude-sonnet-4', rates(3, 15)],
  // Haiku
  ['claude-haiku-4-5', rates(1, 5)],
  ['claude-haiku-3-5', rates(0.8, 4)],
];

/** Matches the longest declared prefix, so `claude-opus-4-8` never resolves to `claude-opus-4`. */
export function pricingFor(model: string | null | undefined): ModelPricing | null {
  if (!model) return null;
  const id = model.toLowerCase();
  let best: { length: number; pricing: ModelPricing } | null = null;
  for (const [prefix, pricing] of TABLE) {
    if (!id.startsWith(prefix)) continue;
    if (!best || prefix.length > best.length) best = { length: prefix.length, pricing };
  }
  return best?.pricing ?? null;
}

export interface TokenUsage {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
  /** The 1-hour share of the cache writes, which bills at 2x rather than 1.25x. */
  cacheWrite1hTokens?: number | null;
}

/**
 * Null when the model is not on the card. Unknown is not free, and a family-shaped guess for a
 * model nobody has priced would be worse than no number at all.
 */
export function estimateCostUsd(
  model: string | null | undefined,
  usage: TokenUsage,
): number | null {
  const pricing = pricingFor(model);
  if (!pricing) return null;

  const cacheWriteTotal = usage.cacheWriteTokens ?? 0;
  // Claude Code writes 1-hour caches, and the transcript reports the split. When it does not,
  // the cheaper 5-minute rate is assumed rather than the dearer one.
  const write1h = Math.min(usage.cacheWrite1hTokens ?? 0, cacheWriteTotal);
  const write5m = Math.max(cacheWriteTotal - write1h, 0);

  const cost =
    ((usage.inputTokens ?? 0) * pricing.inputPerMillion +
      (usage.outputTokens ?? 0) * pricing.outputPerMillion +
      (usage.cacheReadTokens ?? 0) * pricing.cacheReadPerMillion +
      write5m * pricing.cacheWrite5mPerMillion +
      write1h * pricing.cacheWrite1hPerMillion) /
    1_000_000;

  if (!Number.isFinite(cost) || cost <= 0) return null;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
