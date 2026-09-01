import type {
  EventType,
  HealthStatus,
  PromptCategory,
  ProviderStatus,
  RangePreset,
  TaskContext,
} from './enums';

export interface UserFacingError {
  title: string;
  message: string;
  details?: string;
  statusCode: number;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  uptimeMs: number;
  db: { ok: boolean; sizeBytes: number; path: string };
}

export interface SystemConfigResponse {
  name: string;
  version: string;
  apiBaseUrl: string;
  mode: 'native' | 'docker';
  dataDirectory: string;
  /** In Docker mode the container sees /data; this is where the files actually live. */
  hostDataDirectory: string | null;
  databasePath: string;
  timezone: string;
  onboardingComplete: boolean;
  capabilities: {
    hooks: boolean;
    export: boolean;
  };
  providers: ProviderSummary[];
}

export interface StorageResponse {
  databasePath: string;
  databaseSizeBytes: number;
  walSizeBytes: number;
  integrity: 'ok' | 'failed' | 'unknown';
  tables: Array<{ table: string; rows: number }>;
  backups: Array<{ file: string; sizeBytes: number; createdAt: string }>;
  dataDirectory: string;
}

export interface ProviderCapabilities {
  historicalBackfill: boolean;
  realtime: boolean;
  tokens: boolean;
  cost: boolean;
  responses: boolean;
  toolActivity: boolean;
}

export interface ProviderSummary {
  id: string;
  name: string;
  status: ProviderStatus;
  enabled: boolean;
  capabilities: ProviderCapabilities;
  detected: boolean;
  detectionMessage?: string;
  connectedAt?: string | null;
  lastEventAt?: string | null;
  eventCount: number;
  lastError?: string | null;
  health: { status: HealthStatus; reason?: string };
  warnings: string[];
}

export interface DetectionResult {
  detected: boolean;
  version?: string | null;
  message: string;
  details?: Record<string, string | number>;
}

export interface BackfillProgress {
  providerId: string;
  state: 'idle' | 'running' | 'done' | 'cancelled' | 'error';
  filesTotal: number;
  filesDone: number;
  bytesTotal: number;
  bytesDone: number;
  eventsIngested: number;
  eventsDeduped: number;
  parseErrors: number;
  startedAt?: string;
  finishedAt?: string;
  message?: string;
}

export interface ResolvedRange {
  preset: RangePreset;
  from: string;
  to: string;
  timezone: string;
  previousFrom: string;
  previousTo: string;
}

export interface MetricDelta {
  value: number;
  previous: number;
  changePct: number | null;
}

/** Cost is null when no priced model was seen, which is different from costing nothing. */
export interface CostDelta {
  value: number | null;
  previous: number | null;
  changePct: number | null;
}

/**
 * Every figure here describes the selected range and nothing else. There is deliberately no
 * separate "today" block: "today" is one of the range presets, so a second fixed window on
 * the same screen would contradict the filter the reader just set.
 */
export interface OverviewPeriod {
  prompts: MetricDelta;
  sessions: MetricDelta;
  activeMs: MetricDelta;
  tokens: MetricDelta;
  toolCalls: MetricDelta;
  estimatedCostUsd: CostDelta;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** input + output + cache read + cache write: what the cost is actually built from. */
  billableTokens: MetricDelta;
  projects: number;
  promptsPerSession: number;
  msPerSession: number;
  busiestBucket: { bucket: string; prompts: number } | null;
}

/** What the machine already knows about how this usage is actually paid for. */
export interface PlanSummary {
  billing: 'subscription' | 'api' | 'unknown';
  name: string | null;
  monthlyUsd: number | null;
  /** The subscription fee attributable to the selected range, prorated by days. */
  periodUsd: number | null;
  /** Anthropic's own window percentages. A live snapshot; there is no history to draw. */
  usage: Array<{ kind: string; percent: number; resetsAt: string | null }>;
  usageFetchedAt: string | null;
  /** Real money spent beyond the plan fee. */
  overageUsd: number | null;
}

export interface OverviewResponse {
  range: ResolvedRange;
  /** Bucket size of `timeline`; active time is only meaningful at day granularity. */
  granularity: 'hour' | 'day' | 'week';
  period: OverviewPeriod;
  plan: PlanSummary | null;
  sources: Array<{ providerId: string; name: string; prompts: number; share: number }>;
  categories: Array<{ category: PromptCategory; prompts: number; share: number }>;
  projects: Array<{ projectId: string; name: string; prompts: number; share: number }>;
  technologies: Array<{ technology: string; prompts: number; share: number }>;
  /** Counted on replies, which is where a transcript records the model. */
  models: Array<{ model: string; responses: number; share: number }>;
  timeline: TimeseriesPoint[];
  totals: { events: number; prompts: number; sessions: number; projects: number };
}

export interface TimeseriesPoint {
  bucket: string;
  prompts: number;
  sessions: number;
  activeMs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
}

export interface TimeseriesResponse {
  range: ResolvedRange;
  granularity: 'hour' | 'day' | 'week';
  points: TimeseriesPoint[];
}

export interface ModelUsage {
  model: string;
  modelFamily: string | null;
  events: number;
  prompts: number;
  responses: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedCostUsd: number | null;
  share: number;
}

export interface ProjectUsage {
  projectId: string;
  name: string;
  path: string | null;
  repository: string | null;
  prompts: number;
  sessions: number;
  activeMs: number;
  lastActivityAt: string | null;
  topCategories: Array<{ category: PromptCategory; count: number }>;
  topTechnologies: Array<{ technology: string; count: number }>;
  topModels: Array<{ model: string; count: number }>;
}

export interface CategoryUsage {
  category: PromptCategory;
  prompts: number;
  share: number;
  avgConfidence: number;
  previousShare: number | null;
}

export interface TechnologyUsage {
  technology: string;
  prompts: number;
  share: number;
  contexts: Array<{ context: TaskContext; count: number }>;
}

export interface SessionSummary {
  id: string;
  providerId: string;
  providerName: string;
  externalId: string | null;
  projectId: string | null;
  projectName: string | null;
  primaryModel: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  activeMs: number;
  promptCount: number;
  toolCount: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
  categories: Array<{ category: PromptCategory; count: number }>;
  /** True when the session began before the window; the row reports only the part inside it. */
  startedBeforeRange: boolean;
  /** Running right now, according to Claude Code's own live-session registry. */
  live: LiveSessionInfo | null;
}

/** A session that is running at this moment. Read from a local file; nothing is signalled. */
export interface LiveSessionInfo {
  pid: number;
  name: string | null;
  kind: string | null;
  entrypoint: string | null;
  startedAt: string | null;
}

export interface SessionsResponse extends Paginated<SessionSummary> {
  /** Live sessions with no stored events yet: started, but not yet on any chart. */
  liveOnly: Array<{ externalId: string; workingDirectory: string | null } & LiveSessionInfo>;
  totals: {
    sessions: number;
    prompts: number;
    activeMs: number;
    estimatedCostUsd: number | null;
    liveNow: number;
  };
}

export interface SessionDetail extends SessionSummary {
  timeline: Array<{
    id: string;
    timestamp: string;
    eventType: EventType;
    label: string;
    model: string | null;
    toolName: string | null;
    category: PromptCategory | null;
    isSubagent: boolean;
  }>;
}

export interface ActivityItem {
  id: string;
  timestamp: string;
  eventType: EventType;
  providerId: string;
  providerName: string;
  model: string | null;
  projectId: string | null;
  projectName: string | null;
  sessionId: string | null;
  category: PromptCategory | null;
  categoryConfidence: number | null;
  preview: string | null;
  toolName: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  isSubagent: boolean;
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
}

export interface PromptListItem extends ActivityItem {
  charLength: number;
  wordLength: number;
  redactionCount: number;
  technologies: string[];
}

export interface PromptDetail extends PromptListItem {
  text: string | null;
  textAvailable: boolean;
  response: string | null;
  contexts: TaskContext[];
  repository: string | null;
  gitBranch: string | null;
  workingDirectory: string | null;
  sourceVersion: string | null;
  estimatedCostUsd: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
}

/** Your own recurring vocabulary, offered as one-click searches beside the prompt list. */
export interface PromptThemesResponse {
  range: ResolvedRange;
  themes: Array<{ term: string; count: number }>;
}

export type InsightKind =
  | 'category_shift'
  | 'usage_trend'
  | 'repeated_prompt'
  | 'prompt_length'
  | 'peak_hours'
  | 'session_length'
  | 'cache_efficiency'
  | 'dominant_category'
  | 'top_project'
  | 'model_mix'
  | 'technology_focus';

export interface Insight {
  id: string;
  kind: InsightKind;
  headline: string;
  detail: string;
  /** Higher is more worth reading. The page leads with the highest and demotes the rest. */
  score: number;
  /** Where to go to see it for yourself. Null when nothing on another page shows it. */
  href: string | null;
  evidence: {
    value: number;
    /** How to render `value`; a bare number means nothing without its unit. */
    unit: 'count' | 'percent' | 'points' | 'duration' | 'tokens';
    /** The denominator, in words: "of 2,977 prompts". */
    of: string;
    sampleSize: number;
    comparedWith?: string;
  };
}

export interface InsightsResponse {
  range: ResolvedRange;
  /** What this period was mostly about, in one sentence. Null below the sample floor. */
  summary: string | null;
  /** What the reading rests on, so the reader can weigh it. */
  basis: { prompts: number; sessions: number; recordedSince: string | null };
  /** When the work happened. No other screen answers this. */
  rhythm: {
    hours: Array<{ hour: number; prompts: number }>;
    weekdays: Array<{ weekday: number; prompts: number }>;
    peak: { fromHour: number; toHour: number; prompts: number } | null;
  };
  insights: Insight[];
  /** Observations that were computed and withheld for want of a large enough sample. */
  suppressed: number;
  /** Why the page is empty, when it is. */
  reason: string | null;
}

export interface SettingsResponse {
  redactSecrets: boolean;
  metadataOnly: boolean;
  storeResponses: boolean;
  timezone: string;
  idleTimeoutMinutes: number;
  scanManifests: boolean;
  retentionMonths: number;
  onboardingComplete: boolean;
}

export interface DeletePreview {
  scope: string;
  events: number;
  prompts: number;
  sessions: number;
  projects: number;
}

export interface IngestResult {
  accepted: number;
  deduped: number;
  failed: number;
  /** Dropped because the provider is paused. Not an error, and not silent. */
  skipped: number;
  batchId: string;
}
