import { Injectable } from '@nestjs/common';
import { ACTIVE_TIME_TAIL_ALLOWANCE_MS } from '@ai-footprint/shared';
import type { Insight, InsightsResponse, RangeQuery } from '@ai-footprint/shared';
import { StoreService } from '../common';
import { AnalyticsService, peakWindow } from './analytics.service';
import { changePct } from './range';

/** Below this, any observation is an anecdote. Four confident findings from thirty prompts is
 *  exactly the failure this page is supposed to avoid. */
const MIN_PROMPTS = 40;
const MIN_CATEGORY_SHARE = 20;
const MIN_TREND_CHANGE = 15;
/** A share that moved by less than this is noise, not a change worth a sentence. */
const MIN_SHIFT_POINTS = 8;

function hourLabel(hour: number): string {
  const normalized = ((hour % 24) + 24) % 24;
  const suffix = normalized < 12 ? 'AM' : 'PM';
  const display = normalized % 12 === 0 ? 12 : normalized % 12;
  return `${display} ${suffix}`;
}

function plural(count: number, word: string): string {
  return `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * Brief §28: insights come only from real data. Every observation carries the count behind it,
 * and anything failing a minimum-sample guard is withheld rather than softened.
 *
 * The page is also required to be worth reading. Overview already ranks categories, projects,
 * models and technologies with bars and deltas, so restating those as sentences taught nobody
 * anything, this scores observations and leads with the one that says the most, preferring
 * CHANGE (a share that moved, a prompt sent sixty times) over leaderboards.
 *
 * It is the only reading of your habits in the product. A separate profile page said the same
 * things in a second layout, the same category ranking, the same busiest project, so its one
 * genuine contribution, the sentence naming what the period was about, moved here instead.
 */
@Injectable()
export class InsightsService {
  constructor(
    private readonly stores: StoreService,
    private readonly analytics: AnalyticsService,
  ) {}

  generate(query: RangeQuery): InsightsResponse {
    const store = this.stores.store;
    const scope = this.analytics.scope(query);
    const { range, filters, previous } = scope;
    const totals = store.analytics.totals(
      filters,
      scope.idleTimeoutMs,
      ACTIVE_TIME_TAIL_ALLOWANCE_MS,
    );
    const insights: Insight[] = [];
    let suppressed = 0;

    const hours = store.analytics.activeHours(filters);
    const rhythm = {
      hours,
      weekdays: store.analytics.activeWeekdays(filters),
      peak: peakWindow(hours),
    };
    const basis = {
      prompts: totals.prompts,
      sessions: totals.sessions,
      recordedSince: store.analytics.firstEventAt(filters),
    };

    if (totals.prompts < MIN_PROMPTS) {
      return {
        range,
        summary: null,
        basis,
        rhythm,
        insights: [],
        suppressed: 0,
        reason: `Not enough to go on yet — ${plural(totals.prompts, 'prompt')} in this selection, and an observation needs at least ${MIN_PROMPTS} before it means anything.`,
      };
    }

    const link = (path: string): string =>
      `${path}${path.includes('?') ? '&' : '?'}range=${range.preset}`;
    const categories = store.analytics.byCategory(filters);
    const priorCategories = store.analytics.byCategory(previous);
    const priorTotal = priorCategories.reduce((sum, row) => sum + row.count, 0);

    // ---- change, which is the only thing this page can say that Overview cannot ----

    if (priorTotal > 0) {
      const priorByKey = new Map(priorCategories.map((row) => [row.key, row.count]));
      let biggest: { key: string; now: number; before: number; shift: number } | null = null;
      for (const row of categories) {
        if (row.key === 'Other') continue;
        const now = (row.count / totals.prompts) * 100;
        const before = ((priorByKey.get(row.key) ?? 0) / priorTotal) * 100;
        const shift = now - before;
        if (!biggest || Math.abs(shift) > Math.abs(biggest.shift)) {
          biggest = { key: row.key, now, before, shift };
        }
      }
      if (biggest && Math.abs(biggest.shift) >= MIN_SHIFT_POINTS) {
        const direction = biggest.shift > 0 ? 'grew' : 'shrank';
        insights.push({
          id: 'category_shift',
          kind: 'category_shift',
          headline: `${biggest.key} ${direction} from ${Math.round(biggest.before)}% to ${Math.round(biggest.now)}% of what you brought to AI.`,
          detail: `A ${Math.abs(Math.round(biggest.shift))}-point move against the period before this one. Nothing else on any screen shows this.`,
          score: 100 + Math.abs(biggest.shift),
          href: link(`/prompts?category=${encodeURIComponent(biggest.key)}`),
          evidence: {
            value: Math.round(Math.abs(biggest.shift)),
            unit: 'points',
            of: `${plural(totals.prompts, 'prompt')} against ${plural(priorTotal, 'prompt')} before`,
            sampleSize: totals.prompts + priorTotal,
            comparedWith: 'the previous period',
          },
        });
      } else if (biggest) {
        suppressed += 1;
      }
    }

    const change = changePct(totals.prompts, priorTotal);
    if (change !== null && Math.abs(change) >= MIN_TREND_CHANGE) {
      const direction = change > 0 ? 'rose' : 'fell';
      insights.push({
        id: 'usage_trend',
        kind: 'usage_trend',
        headline: `Your AI usage ${direction} ${Math.abs(Math.round(change))}% against the period before.`,
        detail: `${plural(totals.prompts, 'prompt')} this period against ${plural(priorTotal, 'prompt')} before it.`,
        score: 90 + Math.min(Math.abs(change), 50),
        href: link('/activity'),
        evidence: {
          value: Math.round(Math.abs(change)),
          unit: 'percent',
          of: `${plural(totals.prompts, 'prompt')} against ${plural(priorTotal, 'prompt')}`,
          sampleSize: totals.prompts,
          comparedWith: 'the previous period',
        },
      });
    } else if (change !== null) {
      suppressed += 1;
    }

    const repeated = store.prompts.repeated({ ...filters, includeSubagents: false }, 1)[0];
    // Metadata-only mode stores no text, so there is nothing to quote and nothing to say.
    if (repeated && repeated.count >= 5 && repeated.text) {
      insights.push({
        id: 'repeated_prompt',
        kind: 'repeated_prompt',
        headline: `You sent essentially the same prompt ${repeated.count} times.`,
        detail: `"${repeated.text.slice(0, 120)}${repeated.text.length > 120 ? '…' : ''}" — something worth a snippet, a script, or a command.`,
        score: 80 + Math.min(repeated.count, 40),
        href: link(`/prompts?q=${encodeURIComponent(repeated.text.slice(0, 40))}`),
        evidence: {
          value: repeated.count,
          unit: 'count',
          of: plural(totals.prompts, 'prompt'),
          sampleSize: totals.prompts,
        },
      });
    }

    const lengths = store.prompts.lengthStats(filters);
    if (lengths.total >= MIN_PROMPTS && lengths.avgWords > 0) {
      insights.push({
        id: 'prompt_length',
        kind: 'prompt_length',
        headline: `Your average prompt runs to ${Math.round(lengths.avgWords)} words.`,
        detail:
          lengths.avgWords > 120
            ? 'Long prompts carry more context, and cost more to send every turn.'
            : 'Short prompts lean on the conversation that came before them.',
        score: 50,
        href: link('/prompts'),
        evidence: {
          value: Math.round(lengths.avgWords),
          unit: 'count',
          of: `words across ${plural(lengths.total, 'prompt')}`,
          sampleSize: lengths.total,
        },
      });
    }

    // ---- rhythm and cost, which Overview shows only as single figures ----

    const peak = rhythm.peak;
    if (peak && peak.prompts / totals.prompts >= 0.2) {
      const share = Math.round((peak.prompts / totals.prompts) * 100);
      insights.push({
        id: 'peak_hours',
        kind: 'peak_hours',
        headline: `${share}% of your prompts fall between ${hourLabel(peak.fromHour)} and ${hourLabel(peak.toHour)}.`,
        detail: 'A three-hour window carrying a disproportionate share of the work.',
        score: 60 + share,
        href: link('/activity'),
        evidence: {
          value: share,
          unit: 'percent',
          of: plural(totals.prompts, 'prompt'),
          sampleSize: totals.prompts,
        },
      });
    } else if (peak) {
      suppressed += 1;
    }

    if (totals.sessions > 0) {
      const minutes = Math.round(totals.activeMs / totals.sessions / 60_000);
      if (minutes > 0) {
        insights.push({
          id: 'session_length',
          kind: 'session_length',
          headline: `A session runs about ${formatMinutes(minutes)} of active time.`,
          detail: 'Idle gaps are excluded, so this is time worked rather than time elapsed.',
          score: 40,
          href: link('/sessions'),
          evidence: {
            value: totals.activeMs / totals.sessions,
            unit: 'duration',
            of: plural(totals.sessions, 'session'),
            sampleSize: totals.sessions,
          },
        });
      }
    }

    // Computed exactly as the Overview tile computes it, including cache writes. Leaving them
    // out gave the two screens different percentages for the same range.
    const inbound = totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
    if (inbound > 0) {
      const ratio = Math.round((totals.cacheReadTokens / inbound) * 100);
      if (ratio >= 40) {
        insights.push({
          id: 'cache_efficiency',
          kind: 'cache_efficiency',
          headline: `${ratio}% of the context you send is re-read from cache.`,
          detail:
            'Cached reads bill at a tenth of fresh input, so a long conversation costs far less than its token count suggests.',
          score: 45,
          href: null,
          evidence: {
            value: ratio,
            unit: 'percent',
            of: `${inbound.toLocaleString()} incoming tokens`,
            sampleSize: inbound,
          },
        });
      }
    }

    // ---- the leaderboards, kept but scored below everything above, since Overview ranks
    //      all of them with bars, counts and deltas ----

    const top = categories[0];
    if (top && top.key !== 'Other') {
      const pct = Math.round((top.count / totals.prompts) * 100);
      if (pct >= MIN_CATEGORY_SHARE) {
        insights.push({
          id: 'dominant_category',
          kind: 'dominant_category',
          headline: `You used AI mostly for ${top.key.toLowerCase()}.`,
          detail: `${pct}% of your prompts in this period.`,
          score: 20 + pct / 10,
          href: link(`/prompts?category=${encodeURIComponent(top.key)}`),
          evidence: {
            value: pct,
            unit: 'percent',
            of: plural(totals.prompts, 'prompt'),
            sampleSize: totals.prompts,
          },
        });
      } else {
        suppressed += 1;
      }
    }

    const topProject = store.analytics.byProject(filters, 1)[0];
    if (topProject && topProject.count > 0) {
      const pct = Math.round((topProject.count / totals.prompts) * 100);
      insights.push({
        id: 'top_project',
        kind: 'top_project',
        headline: `${topProject.name} took ${pct}% of your prompts.`,
        detail: `${plural(topProject.count, 'prompt')} out of ${totals.prompts.toLocaleString()}.`,
        score: 15 + pct / 10,
        href: link(`/prompts?projectId=${encodeURIComponent(topProject.key)}`),
        evidence: {
          value: pct,
          unit: 'percent',
          of: plural(totals.prompts, 'prompt'),
          sampleSize: totals.prompts,
        },
      });
    }

    const models = store.analytics.byModel(filters).filter((row) => !row.model.startsWith('<'));
    const replies = models.reduce((sum, row) => sum + row.responses, 0);
    const first = models[0];
    if (first && replies > 0 && models.length > 1) {
      const pct = Math.round((first.responses / replies) * 100);
      insights.push({
        id: 'model_mix',
        kind: 'model_mix',
        headline: `${first.model} answered ${pct}% of your turns.`,
        detail: `${models.length} models in use across this period.`,
        score: 12,
        href: link(`/activity?model=${encodeURIComponent(first.model)}`),
        evidence: {
          value: pct,
          unit: 'percent',
          of: plural(replies, 'reply'),
          sampleSize: replies,
        },
      });
    }

    const topTech = store.analytics.byTechnology(filters, 1)[0];
    if (topTech && topTech.count > 0) {
      insights.push({
        id: 'technology_focus',
        kind: 'technology_focus',
        headline: `${topTech.key} was the technology you discussed most.`,
        detail: `Mentioned in ${plural(topTech.count, 'prompt')}.`,
        score: 10,
        href: link(`/prompts?technology=${encodeURIComponent(topTech.key)}`),
        evidence: {
          value: topTech.count,
          unit: 'count',
          of: plural(totals.prompts, 'prompt'),
          sampleSize: totals.prompts,
        },
      });
    }

    insights.sort((a, b) => b.score - a.score);
    const topProviderRows = store.analytics.byProvider(filters);
    return {
      range,
      summary: summarise({
        categories: categories.filter((row) => row.key !== 'Other'),
        prompts: totals.prompts,
        providers: topProviderRows,
        project: topProject ?? null,
        peak,
      }),
      basis,
      rhythm,
      insights,
      suppressed,
      reason: null,
    };
  }
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * One sentence naming what the period was about, assembled from the same counts the page shows
 * beneath it. A reading should state its conclusion before its working. Six floating
 * percentages left the reader to draw the conclusion themselves.
 */
function summarise(input: {
  categories: Array<{ key: string; count: number }>;
  prompts: number;
  providers: Array<{ key: string; name: string; count: number }>;
  project: { name: string; count: number } | null;
  peak: { fromHour: number; toHour: number; prompts: number } | null;
}): string | null {
  if (input.prompts === 0) return null;

  const top = input.categories.slice(0, 2);
  const areas =
    top.length === 0
      ? 'across a mix of work'
      : top.length === 1
        ? `mostly on ${top[0]!.key.toLowerCase()}`
        : `mostly on ${top[0]!.key.toLowerCase()} and ${top[1]!.key.toLowerCase()}`;

  const providerTotal = input.providers.reduce((sum, row) => sum + row.count, 0);
  const provider = input.providers[0];
  const tool =
    provider && providerTotal > 0
      ? `${provider.count / providerTotal >= 0.9 ? 'almost entirely in' : 'mainly in'} ${provider.name}`
      : null;

  const project = input.project ? `mostly in ${input.project.name}` : null;
  const when = input.peak
    ? `and most of it between ${hourLabel(input.peak.fromHour)} and ${hourLabel(input.peak.toHour)}`
    : null;

  return `${[`You used AI ${areas}`, tool, project, when].filter(Boolean).join(', ')}.`;
}
