export const PROMPT_CATEGORIES = [
  'Implementation',
  'Debugging',
  'Code Review',
  'Refactoring',
  'Explanation',
  'Research',
  'Planning',
  'Documentation',
  'Testing',
  'DevOps',
  'Architecture',
  'Writing',
  'Other',
] as const;
export type PromptCategory = (typeof PROMPT_CATEGORIES)[number];

export const TASK_CONTEXTS = [
  'Backend',
  'Frontend',
  'Smart Contract',
  'Infrastructure',
  'Testing',
  'Architecture',
  'Documentation',
  'Research',
] as const;
export type TaskContext = (typeof TASK_CONTEXTS)[number];

export const EVENT_TYPES = [
  'prompt',
  'response',
  'tool_call',
  'session_start',
  'session_end',
  'compaction',
  'error',
  'notification',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const PROVIDER_STATUSES = ['disconnected', 'connecting', 'connected', 'error'] as const;
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];

export const HEALTH_STATUSES = ['ok', 'degraded', 'broken', 'unknown'] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const RANGE_PRESETS = ['today', '7d', '30d', '3m', 'all', 'custom'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const MODEL_FAMILIES = [
  'opus',
  'sonnet',
  'haiku',
  'gpt',
  'gemini',
  'llama',
  'unknown',
] as const;
export type ModelFamily = (typeof MODEL_FAMILIES)[number];
