import { Injectable } from '@nestjs/common';
import { ACTIVE_TIME_TAIL_ALLOWANCE_MS } from '@ai-footprint/shared';
import type { Insight, InsightsResponse, RangeQuery } from '@ai-footprint/shared';
import { StoreService } from '../common';
import { AnalyticsService, peakWindow } from './analytics.service';
import { changePct } from './range';

/** Below this, any observation is an anecdote. Four confident findings from thirty prompts is
 *  exactly the failure this page is supposed to avoid. */
const MIN_PROMPTS = 40;
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
 * Only change is reported here. Rankings of category, project, model and technology live on
 * Overview; the summary sentence and the rhythm charts cover the rest. Every observation
 * carries its sample count, and anything under the floor is withheld.
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
          unit: 'words',
          of: plural(lengths.total, 'prompt'),
          sampleSize: lengths.total,
        },
      });
    }

    // Nothing may be pushed past this point that restates a ranking Overview draws or a figure
    // the sentence below puts in words. Four leaderboard observations, the peak window and the
    // average session length all used to live here, and every one of them agreed with a tile on
    // another screen.
    insights.sort((a, b) => b.score - a.score);

    return {
      range,
      summary: summarise({
        categories: categories.filter((row) => row.key !== 'Other'),
        prompts: totals.prompts,
        providers: store.analytics.byProvider(filters),
        project: store.analytics.byProject(filters, 1)[0] ?? null,
        peak: rhythm.peak,
      }),
      basis,
      rhythm,
      insights,
      suppressed,
      reason: null,
    };
  }
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
