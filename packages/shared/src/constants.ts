export const APP_NAME = 'AI Footprint';
export const APP_TAGLINE = 'Understand how you use AI.';
export const APP_DIR_NAME = 'ai-footprint';

export const DEFAULT_APP_PORT = 4173;

export const INGEST_TOKEN_HEADER = 'x-ai-footprint-token';

export const INGEST_BATCH_SIZE = 500;

/** Gap longer than this between two events in a session is treated as idle, not work. */
export const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
/** Credit given to the final event of a session, which has no successor to measure against. */
export const ACTIVE_TIME_TAIL_ALLOWANCE_MS = 60 * 1000;

/** Bumped when the transcript parser changes in a way that requires re-ingestion. */
export const INGEST_VERSION = 1;
/** Bumped when classification/technology detection changes; triggers targeted re-enrichment. */
export const ENRICHMENT_VERSION = 1;
export const CLASSIFIER_VERSION = 1;
export const PRICING_VERSION = 1;
