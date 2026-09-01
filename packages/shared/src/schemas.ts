import { z } from 'zod';
import { EVENT_TYPES, PROMPT_CATEGORIES, RANGE_PRESETS, TASK_CONTEXTS } from './enums';

/**
 * A year outside 0001-9999 serialises as `+057615-06-05T...`, which is what a tool that
 * mistakes microseconds for milliseconds emits. julianday() returns NULL for it and aborts the
 * ingest transaction, so reject it here and report the row in `failed`.
 */
/** An unparseable zone was accepted and then computed against the server's own offset. */
export const ianaTimeZone = z
  .string()
  .max(64)
  .refine(
    (value) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Not a time zone this system recognises' },
  );

export const isoTimestamp = z
  .string()
  .min(4)
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'Not a valid ISO-8601 timestamp' })
  .refine(
    (v) => {
      const parsed = new Date(v);
      // Unparseable is already rejected above; toISOString() would throw here instead of
      // failing validation, which is a 500 rather than a 400.
      if (Number.isNaN(parsed.getTime())) return true;
      return !/^[+-]/.test(parsed.toISOString());
    },
    { message: 'Timestamp year is outside the range this application can store' },
  );

export const aiEventInputSchema = z.object({
  externalId: z.string().max(256).nullish(),
  providerId: z.string().min(1).max(64).optional(),
  product: z.string().max(128).nullish(),
  model: z.string().max(128).nullish(),
  timestamp: isoTimestamp,
  tzOffsetMinutes: z.number().int().min(-900).max(900).optional(),
  sessionId: z.string().max(256).nullish(),
  parentEventId: z.string().max(256).nullish(),
  isSubagent: z.boolean().optional(),
  workingDirectory: z.string().max(4096).nullish(),
  repository: z.string().max(512).nullish(),
  gitBranch: z.string().max(256).nullish(),
  eventType: z.enum(EVENT_TYPES),
  prompt: z.string().nullish(),
  response: z.string().nullish(),
  toolName: z.string().max(128).nullish(),
  toolSucceeded: z.boolean().nullish(),
  inputTokens: z.number().int().nonnegative().nullish(),
  outputTokens: z.number().int().nonnegative().nullish(),
  cacheReadTokens: z.number().int().nonnegative().nullish(),
  cacheWriteTokens: z.number().int().nonnegative().nullish(),
  cacheWrite1hTokens: z.number().int().min(0).nullish(),
  durationMs: z.number().int().nonnegative().nullish(),
  sourceVersion: z.string().max(64).nullish(),
  metadata: z.record(z.unknown()).nullish(),
});
export type AIEventInput = z.infer<typeof aiEventInputSchema>;

export const ingestBatchSchema = z.object({
  providerId: z.string().min(1).max(64),
  events: z.array(aiEventInputSchema).min(1).max(2000),
});
export type IngestBatch = z.infer<typeof ingestBatchSchema>;

/** Shape Claude Code's `http` hook posts. Deliberately permissive: hooks must never fail. */
export const hookPayloadSchema = z
  .object({
    hook_event_name: z.string().max(64),
    session_id: z.string().max(256).optional(),
    prompt_id: z.string().max(256).optional(),
    transcript_path: z.string().max(4096).optional(),
    cwd: z.string().max(4096).optional(),
    permission_mode: z.string().max(64).optional(),
    reason: z.string().max(256).optional(),
    model: z.string().max(128).optional(),
    agent_id: z.string().max(256).optional(),
    agent_type: z.string().max(128).optional(),
    effort: z.string().max(64).optional(),
  })
  .passthrough();
export type HookPayload = z.infer<typeof hookPayloadSchema>;

export const rangeQuerySchema = z
  .object({
    range: z.enum(RANGE_PRESETS).default('30d'),
    from: isoTimestamp.optional(),
    to: isoTimestamp.optional(),
    timezone: ianaTimeZone.optional(),
    providerId: z.string().max(64).optional(),
    projectId: z.string().max(64).optional(),
    model: z.string().max(128).optional(),
    category: z.enum(PROMPT_CATEGORIES).optional(),
    technology: z.string().max(64).optional(),
  })
  .refine((v) => v.range !== 'custom' || (v.from && v.to), {
    message: 'A custom range requires both "from" and "to"',
  });
export type RangeQuery = z.infer<typeof rangeQuerySchema>;

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(128).optional(),
});

export const activityQuerySchema = rangeQuerySchema
  .innerType()
  .merge(paginationSchema)
  .extend({ eventType: z.enum(EVENT_TYPES).optional() });

export const promptSearchSchema = rangeQuerySchema
  .innerType()
  .merge(paginationSchema)
  .extend({ q: z.string().max(256).optional() });

export const classifyOverrideSchema = z.object({
  category: z.enum(PROMPT_CATEGORIES),
  contexts: z.array(z.enum(TASK_CONTEXTS)).max(8).optional(),
});

export const connectProviderSchema = z.object({
  backfill: z.boolean().default(true),
  installHooks: z.boolean().default(false),
});

export const deleteScopeSchema = z
  .object({
    scope: z.enum(['all', 'prompts', 'provider', 'project', 'range']),
    providerId: z.string().max(64).optional(),
    projectId: z.string().max(64).optional(),
    from: isoTimestamp.optional(),
    to: isoTimestamp.optional(),
    confirm: z.string().max(64).optional(),
  })
  .refine((v) => v.scope !== 'provider' || !!v.providerId, { message: 'providerId is required' })
  .refine((v) => v.scope !== 'project' || !!v.projectId, { message: 'projectId is required' })
  .refine((v) => v.scope !== 'range' || (!!v.from && !!v.to), {
    message: 'from and to are required',
  });

export const settingsPatchSchema = z.object({
  redactSecrets: z.boolean().optional(),
  metadataOnly: z.boolean().optional(),
  storeResponses: z.boolean().optional(),
  timezone: ianaTimeZone.optional(),
  idleTimeoutMinutes: z.number().int().min(1).max(120).optional(),
  scanManifests: z.boolean().optional(),
  retentionMonths: z.number().int().min(0).max(120).optional(),
});

/**
 * `z.coerce.boolean()` turns the string "false" into true, which is never what a query
 * parameter means. Query booleans are parsed from their text form instead.
 */
export const queryBoolean = (fallback: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => {
      if (value === undefined) return fallback;
      if (typeof value === 'boolean') return value;
      return !['false', '0', 'no', 'off', ''].includes(value.trim().toLowerCase());
    });

export const exportQuerySchema = rangeQuerySchema.innerType().extend({
  format: z.enum(['json', 'csv']).default('json'),
  includePrompts: queryBoolean(true),
});
