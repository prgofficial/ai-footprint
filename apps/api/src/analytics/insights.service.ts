import { Injectable } from '@nestjs/common';
import type { Insight, InsightsResponse, RangeQuery } from '@ai-footprint/shared';
import { StoreService } from '../common';
import { AnalyticsService, peakWindow } from './analytics.service';
import { changePct } from './range';

const MIN_PROMPTS = 15;
const MIN_CATEGORY_SHARE = 20;
const MIN_TREND_CHANGE = 15;

function hourLabel(hour: number): string {
  const normalized = ((hour % 24) + 24) % 24;
  const suffix = normalized < 12 ? 'AM' : 'PM';
  const display = normalized % 12 === 0 ? 12 : normalized % 12;
  return `${display} ${suffix}`;
}

/**
 * Brief §28: insights must come only from real data. Every card carries the count behind
 * it, and anything that fails a minimum-sample guard is suppressed rather than softened,
 * there is no code path that can produce a sentence without a row count.
 */
@Injectable()
export class InsightsService {
  constructor(
    private readonly stores: StoreService,
    private readonly analytics: AnalyticsService,
  ) {}

  generate(query: RangeQuery): InsightsResponse {
    const store = this.stores.store;
    const { range, filters, previous } = this.analytics.scope(query);
    const totals = store.analytics.totals(filters);
    const insights: Insight[] = [];
    let suppressed = 0;

    if (totals.prompts < MIN_PROMPTS) {
      return { range, insights: [], suppressed: 1 };
    }

    const categories = store.analytics.byCategory(filters);
    const top = categories[0];
    if (top && top.key !== 'Other') {
      const pct = Math.round((top.count / totals.prompts) * 100);
      if (pct >= MIN_CATEGORY_SHARE) {
        insights.push({
          id: 'dominant_category',
          kind: 'dominant_category',
          headline: `You used AI mostly for ${top.key.toLowerCase()} in this period.`,
          detail: `${top.key} represented ${pct}% of your ${totals.prompts} prompts.`,
          evidence: { metric: 'prompts_in_category', value: top.count, sampleSize: totals.prompts },
        });
      } else {
        suppressed += 1;
      }
    }

    const projects = store.analytics.byProject(filters, 2);
    const topProject = projects[0];
    if (topProject && topProject.count >= MIN_PROMPTS / 3) {
      const pct = Math.round((topProject.count / totals.prompts) * 100);
      insights.push({
        id: 'top_project',
        kind: 'top_project',
        headline: `${topProject.name} was your most active AI project.`,
        detail: `${topProject.count} prompts — ${pct}% of everything in this period.`,
        evidence: {
          metric: 'prompts_in_project',
          value: topProject.count,
          sampleSize: totals.prompts,
        },
      });
    } else if (topProject) {
      suppressed += 1;
    }

    const peak = peakWindow(store.analytics.activeHours(filters));
    if (peak && peak.prompts >= totals.prompts * 0.25) {
      insights.push({
        id: 'peak_hours',
        kind: 'peak_hours',
        headline: `Your most active AI period is ${hourLabel(peak.fromHour)}–${hourLabel(peak.toHour)}.`,
        detail: `${peak.prompts} of ${totals.prompts} prompts fell in that window.`,
        evidence: { metric: 'prompts_in_window', value: peak.prompts, sampleSize: totals.prompts },
      });
    } else if (peak) {
      suppressed += 1;
    }

    const prior = store.analytics.totals(previous);
    const change = changePct(totals.prompts, prior.prompts);
    if (change !== null && prior.prompts >= MIN_PROMPTS && Math.abs(change) >= MIN_TREND_CHANGE) {
      const direction = change > 0 ? 'increased' : 'decreased';
      insights.push({
        id: 'usage_trend',
        kind: 'usage_trend',
        headline: `Your AI usage ${direction} ${Math.abs(Math.round(change))}% compared with the previous period.`,
        detail: `${totals.prompts} prompts this period against ${prior.prompts} in the one before.`,
        evidence: {
          metric: 'prompts',
          value: totals.prompts,
          sampleSize: totals.prompts + prior.prompts,
          comparedWith: 'previous_period',
        },
      });
    } else if (prior.prompts > 0) {
      suppressed += 1;
    }

    const models = store.analytics.byModel(filters);
    if (models.length >= 2) {
      const [first, second] = models;
      if (first && second) {
        const totalEvents = models.reduce((sum, row) => sum + row.events, 0);
        const pct = Math.round((first.events / totalEvents) * 100);
        insights.push({
          id: 'model_mix',
          kind: 'model_mix',
          headline: `${first.model} handled ${pct}% of your AI turns.`,
          detail: `You also used ${second.model} for ${Math.round((second.events / totalEvents) * 100)}% of them.`,
          evidence: { metric: 'events_per_model', value: first.events, sampleSize: totalEvents },
        });
      }
    }

    if (totals.sessions >= 5) {
      const average = Math.round(totals.activeMs / totals.sessions / 60_000);
      if (average > 0) {
        insights.push({
          id: 'session_length',
          kind: 'session_length',
          headline: `Your average AI session is about ${average} minute${average === 1 ? '' : 's'} of active time.`,
          detail: `Measured across ${totals.sessions} sessions, excluding idle gaps longer than the configured timeout.`,
          evidence: {
            metric: 'active_ms_per_session',
            value: average,
            sampleSize: totals.sessions,
          },
        });
      }
    }

    const technologies = store.analytics.byTechnology(filters, 1);
    const topTech = technologies[0];
    if (topTech && topTech.count >= MIN_PROMPTS / 3) {
      insights.push({
        id: 'technology_focus',
        kind: 'technology_focus',
        headline: `${topTech.key} was the technology you discussed most.`,
        detail: `Mentioned in ${topTech.count} prompts across this period.`,
        evidence: {
          metric: 'prompts_with_technology',
          value: topTech.count,
          sampleSize: totals.prompts,
        },
      });
    }

    if (totals.cacheReadTokens > 0 && totals.inputTokens > 0) {
      const ratio = Math.round(
        (totals.cacheReadTokens / (totals.cacheReadTokens + totals.inputTokens)) * 100,
      );
      if (ratio >= 40) {
        insights.push({
          id: 'cache_efficiency',
          kind: 'cache_efficiency',
          headline: `${ratio}% of your input came from cached context.`,
          detail:
            'Cached reads are billed at a fraction of fresh input, so long sessions cost less than they look.',
          evidence: {
            metric: 'cache_read_ratio',
            value: ratio,
            sampleSize: totals.cacheReadTokens + totals.inputTokens,
          },
        });
      }
    }

    return { range, insights, suppressed };
  }
}
