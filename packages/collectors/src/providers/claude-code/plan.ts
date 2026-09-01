import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * What Claude Code already knows about the account, from `~/.claude.json`. A local file read,
 * not a request. A subscriber pays a flat monthly fee rather than the API price of their
 * tokens, and the plan that sets it is recorded here.
 */
export interface DetectedPlan {
  /** `subscription` or `api`. A subscriber's API-equivalent figure is hypothetical; an API user's is a bill. */
  billing: 'subscription' | 'api' | 'unknown';
  planId: string | null;
  planName: string | null;
  /** Published monthly price in USD, or null when the tier is not one with a public price. */
  monthlyUsd: number | null;
}

/** Plan consumption as Anthropic itself reports it: exact, and impossible to derive from tokens. */
export interface PlanUsageWindow {
  kind: 'session' | 'weekly_all' | 'weekly_scoped';
  percent: number;
  resetsAt: string | null;
}

export interface DetectedPlanUsage {
  windows: PlanUsageWindow[];
  /** When Claude Code last refreshed the cache. A stale figure must be shown as stale. */
  fetchedAt: string | null;
  /** Real money spent beyond the plan fee, in USD. Zero for a subscriber who has not overflowed. */
  overageUsd: number | null;
}

/**
 * Rate-limit tiers with a published monthly price. Anything else resolves to a name with no
 * price rather than a guessed one; Team and Enterprise seats are negotiated.
 */
const TIER_PRICES: ReadonlyArray<readonly [RegExp, string, number]> = [
  [/max[_-]?20x/i, 'Claude Max 20x', 200],
  [/max[_-]?5x/i, 'Claude Max 5x', 100],
  [/\bmax\b/i, 'Claude Max', 100],
  [/\bpro\b/i, 'Claude Pro', 20],
];

function readClaudeConfig(home = homedir()): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function detectPlan(home = homedir()): DetectedPlan {
  const config = readClaudeConfig(home);
  const account = (config?.oauthAccount ?? {}) as Record<string, unknown>;
  const tier =
    typeof account.organizationRateLimitTier === 'string'
      ? account.organizationRateLimitTier
      : null;
  const billingType = typeof account.billingType === 'string' ? account.billingType : null;

  const billing: DetectedPlan['billing'] = billingType
    ? billingType.includes('subscription')
      ? 'subscription'
      : 'api'
    : 'unknown';

  for (const [pattern, name, price] of TIER_PRICES) {
    if (tier && pattern.test(tier))
      return { billing, planId: tier, planName: name, monthlyUsd: price };
  }
  return { billing, planId: tier, planName: tier ? null : null, monthlyUsd: null };
}

export function detectPlanUsage(home = homedir()): DetectedPlanUsage | null {
  const config = readClaudeConfig(home);
  const cached = config?.cachedUsageUtilization as Record<string, unknown> | undefined;
  const utilization = cached?.utilization as Record<string, unknown> | undefined;
  if (!utilization) return null;

  const raw = Array.isArray(utilization.limits)
    ? (utilization.limits as Array<Record<string, unknown>>)
    : [];
  const windows: PlanUsageWindow[] = raw
    .filter((limit) => typeof limit.kind === 'string')
    .map((limit) => ({
      kind: limit.kind as PlanUsageWindow['kind'],
      percent: typeof limit.percent === 'number' ? limit.percent : 0,
      resetsAt: typeof limit.resets_at === 'string' ? limit.resets_at : null,
    }));

  const spend = (utilization.spend as Record<string, unknown> | undefined)?.used as
    Record<string, unknown> | undefined;
  const minor = typeof spend?.amount_minor === 'number' ? spend.amount_minor : null;
  const exponent = typeof spend?.exponent === 'number' ? spend.exponent : 2;

  return {
    windows,
    fetchedAt:
      typeof cached?.fetchedAtMs === 'number' ? new Date(cached.fetchedAtMs).toISOString() : null,
    overageUsd: minor === null ? null : minor / 10 ** exponent,
  };
}
