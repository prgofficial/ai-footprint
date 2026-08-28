/** Shape of the transcript records AI Footprint reads. Every field is optional on purpose:
 *  this format is internal to Claude Code and a missing key must never throw (plan §2.1). */
export interface TranscriptRecord {
  type?: string;
  uuid?: string;
  parentUuid?: string | null;
  sessionId?: string;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  isApiErrorMessage?: boolean;
  userType?: string;
  entrypoint?: string;
  promptId?: string;
  promptSource?: string;
  permissionMode?: string;
  requestId?: string;
  effort?: string;
  slug?: string;
  compactMetadata?: Record<string, unknown>;
  toolUseResult?: unknown;
  message?: TranscriptMessage;
  content?: unknown;
  subtype?: string;
}

export interface TranscriptMessage {
  role?: string;
  model?: string;
  content?: string | TranscriptContentBlock[];
  usage?: TranscriptUsage;
  stop_reason?: string | null;
  id?: string;
}

export interface TranscriptContentBlock {
  type?: string;
  text?: string;
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
  is_error?: boolean;
  tool_use_id?: string;
  content?: unknown;
}

export interface TranscriptUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  service_tier?: string;
}

/** Fields whose disappearance would silently degrade analytics; watched for drift. */
export const TRACKED_FIELDS = [
  'timestamp',
  'sessionId',
  'uuid',
  'cwd',
  'version',
  'message.model',
  'message.usage',
] as const;

export type TrackedField = (typeof TRACKED_FIELDS)[number];
