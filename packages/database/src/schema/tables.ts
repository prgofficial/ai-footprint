import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const providers = sqliteTable('providers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  status: text('status').notNull().default('disconnected'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  connectedAt: text('connected_at'),
  disconnectedAt: text('disconnected_at'),
  configJson: text('config_json'),
  lastError: text('last_error'),
  lastEventAt: text('last_event_at'),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
});

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    path: text('path'),
    name: text('name').notNull(),
    repository: text('repository'),
    gitRemote: text('git_remote'),
    firstSeenAt: text('first_seen_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    techProfileJson: text('tech_profile_json'),
  },
  (t) => [uniqueIndex('projects_path_unique').on(t.path), index('projects_name_idx').on(t.name)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    externalId: text('external_id'),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    startedAt: text('started_at').notNull(),
    endedAt: text('ended_at'),
    durationMs: integer('duration_ms').notNull().default(0),
    activeMs: integer('active_ms').notNull().default(0),
    promptCount: integer('prompt_count').notNull().default(0),
    toolCount: integer('tool_count').notNull().default(0),
    responseCount: integer('response_count').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    estimatedCostUsd: real('estimated_cost_usd'),
    primaryModel: text('primary_model'),
    endReason: text('end_reason'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('sessions_provider_external_unique').on(t.providerId, t.externalId),
    index('sessions_started_idx').on(t.startedAt),
    index('sessions_project_started_idx').on(t.projectId, t.startedAt),
  ],
);

export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    dedupeKey: text('dedupe_key').notNull(),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    product: text('product'),
    model: text('model'),
    modelFamily: text('model_family'),
    timestamp: text('timestamp').notNull(),
    tzOffsetMinutes: integer('tz_offset_minutes').notNull().default(0),
    localDate: text('local_date').notNull(),
    localHour: integer('local_hour').notNull(),
    localWeekday: integer('local_weekday').notNull(),
    sessionId: text('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    externalId: text('external_id'),
    parentEventId: text('parent_event_id'),
    isSubagent: integer('is_subagent', { mode: 'boolean' }).notNull().default(false),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    workingDirectory: text('working_directory'),
    repository: text('repository'),
    gitBranch: text('git_branch'),
    eventType: text('event_type').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cacheReadTokens: integer('cache_read_tokens'),
    cacheWriteTokens: integer('cache_write_tokens'),
    estimatedCostUsd: real('estimated_cost_usd'),
    durationMs: integer('duration_ms'),
    sourceVersion: text('source_version'),
    ingestVersion: integer('ingest_version').notNull().default(1),
    enrichmentVersion: integer('enrichment_version').notNull().default(0),
    metadataJson: text('metadata_json'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('events_dedupe_key_unique').on(t.dedupeKey),
    index('events_timestamp_idx').on(t.timestamp),
    index('events_provider_timestamp_idx').on(t.providerId, t.timestamp),
    index('events_project_timestamp_idx').on(t.projectId, t.timestamp),
    index('events_session_timestamp_idx').on(t.sessionId, t.timestamp),
    index('events_type_timestamp_idx').on(t.eventType, t.timestamp),
    index('events_model_idx').on(t.model),
    index('events_local_date_idx').on(t.localDate),
    index('events_enrichment_idx').on(t.enrichmentVersion, t.eventType),
  ],
);

export const prompts = sqliteTable(
  'prompts',
  {
    eventId: text('event_id')
      .primaryKey()
      .references(() => events.id, { onDelete: 'cascade' }),
    text: text('text'),
    textHash: text('text_hash').notNull(),
    normalizedHash: text('normalized_hash').notNull(),
    charLength: integer('char_length').notNull(),
    wordLength: integer('word_length').notNull(),
    redactionCount: integer('redaction_count').notNull().default(0),
    preview: text('preview'),
  },
  (t) => [index('prompts_normalized_hash_idx').on(t.normalizedHash)],
);

export const responses = sqliteTable('responses', {
  eventId: text('event_id')
    .primaryKey()
    .references(() => events.id, { onDelete: 'cascade' }),
  text: text('text'),
  charLength: integer('char_length').notNull(),
  redactionCount: integer('redaction_count').notNull().default(0),
});

export const toolCalls = sqliteTable(
  'tool_calls',
  {
    eventId: text('event_id')
      .primaryKey()
      .references(() => events.id, { onDelete: 'cascade' }),
    sessionId: text('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    toolName: text('tool_name').notNull(),
    succeeded: integer('succeeded', { mode: 'boolean' }),
    durationMs: integer('duration_ms'),
    targetExtension: text('target_extension'),
  },
  (t) => [
    index('tool_calls_name_idx').on(t.toolName),
    index('tool_calls_session_idx').on(t.sessionId),
  ],
);

export const classifications = sqliteTable(
  'classifications',
  {
    eventId: text('event_id')
      .primaryKey()
      .references(() => events.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    confidence: real('confidence').notNull(),
    source: text('source').notNull().default('heuristic'),
    classifierVersion: integer('classifier_version').notNull(),
  },
  (t) => [index('classifications_category_idx').on(t.category, t.eventId)],
);

export const technologies = sqliteTable(
  'technologies',
  {
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    technology: text('technology').notNull(),
    confidence: real('confidence').notNull(),
    source: text('source').notNull().default('heuristic'),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.technology] }),
    index('technologies_tech_idx').on(t.technology, t.eventId),
  ],
);

export const contexts = sqliteTable(
  'contexts',
  {
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    context: text('context').notNull(),
    confidence: real('confidence').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.context] }),
    index('contexts_context_idx').on(t.context, t.eventId),
  ],
);

export const dailyRollups = sqliteTable(
  'daily_rollups',
  {
    day: text('day').notNull(),
    providerId: text('provider_id').notNull(),
    projectId: text('project_id').notNull().default(''),
    model: text('model').notNull().default(''),
    category: text('category').notNull().default(''),
    prompts: integer('prompts').notNull().default(0),
    responses: integer('responses').notNull().default(0),
    toolCalls: integer('tool_calls').notNull().default(0),
    otherEvents: integer('other_events').notNull().default(0),
    sessions: integer('sessions').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    /** Nullable: unknown is not free. */
    estimatedCostUsd: real('estimated_cost_usd'),
    confidenceSum: real('confidence_sum').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.day, t.providerId, t.projectId, t.model, t.category] }),
    index('daily_rollups_day_idx').on(t.day),
  ],
);

export const dailyActive = sqliteTable(
  'daily_active',
  {
    day: text('day').notNull(),
    providerId: text('provider_id').notNull(),
    activeMs: integer('active_ms').notNull().default(0),
    sessions: integer('sessions').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.providerId] }), index('daily_active_day_idx').on(t.day)],
);

export const collectorState = sqliteTable(
  'collector_state',
  {
    providerId: text('provider_id').notNull(),
    sourcePath: text('source_path').notNull(),
    byteOffset: integer('byte_offset').notNull().default(0),
    size: integer('size').notNull().default(0),
    mtimeMs: integer('mtime_ms').notNull().default(0),
    contentHash: text('content_hash'),
    lineCount: integer('line_count').notNull().default(0),
    parseErrors: integer('parse_errors').notNull().default(0),
    lastScannedAt: text('last_scanned_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.providerId, t.sourcePath] })],
);

export const ingestLog = sqliteTable(
  'ingest_log',
  {
    batchId: text('batch_id').primaryKey(),
    providerId: text('provider_id').notNull(),
    source: text('source').notNull(),
    accepted: integer('accepted').notNull().default(0),
    deduped: integer('deduped').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    parseErrors: integer('parse_errors').notNull().default(0),
    startedAt: text('started_at').notNull(),
    finishedAt: text('finished_at'),
  },
  (t) => [index('ingest_log_started_idx').on(t.startedAt)],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const schemaMeta = sqliteTable('schema_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const migrations = sqliteTable('_migrations', {
  id: text('id').primaryKey(),
  hash: text('hash').notNull(),
  appliedAt: text('applied_at').notNull(),
});
