CREATE TABLE providers (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disconnected',
  enabled INTEGER NOT NULL DEFAULT 1,
  connected_at TEXT,
  disconnected_at TEXT,
  config_json TEXT,
  last_error TEXT,
  last_event_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY NOT NULL,
  path TEXT,
  name TEXT NOT NULL,
  repository TEXT,
  git_remote TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  tech_profile_json TEXT
);
CREATE UNIQUE INDEX projects_path_unique ON projects (path);
CREATE INDEX projects_name_idx ON projects (name);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  external_id TEXT,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  active_ms INTEGER NOT NULL DEFAULT 0,
  prompt_count INTEGER NOT NULL DEFAULT 0,
  tool_count INTEGER NOT NULL DEFAULT 0,
  response_count INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL,
  primary_model TEXT,
  end_reason TEXT,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX sessions_provider_external_unique ON sessions (provider_id, external_id);
CREATE INDEX sessions_started_idx ON sessions (started_at);
CREATE INDEX sessions_project_started_idx ON sessions (project_id, started_at);

CREATE TABLE events (
  id TEXT PRIMARY KEY NOT NULL,
  dedupe_key TEXT NOT NULL,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  product TEXT,
  model TEXT,
  model_family TEXT,
  timestamp TEXT NOT NULL,
  tz_offset_minutes INTEGER NOT NULL DEFAULT 0,
  local_date TEXT NOT NULL,
  local_hour INTEGER NOT NULL,
  local_weekday INTEGER NOT NULL,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  external_id TEXT,
  parent_event_id TEXT,
  is_subagent INTEGER NOT NULL DEFAULT 0,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  working_directory TEXT,
  repository TEXT,
  git_branch TEXT,
  event_type TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  estimated_cost_usd REAL,
  duration_ms INTEGER,
  source_version TEXT,
  ingest_version INTEGER NOT NULL DEFAULT 1,
  enrichment_version INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX events_dedupe_key_unique ON events (dedupe_key);
CREATE INDEX events_timestamp_idx ON events (timestamp);
CREATE INDEX events_provider_timestamp_idx ON events (provider_id, timestamp);
CREATE INDEX events_project_timestamp_idx ON events (project_id, timestamp);
CREATE INDEX events_session_timestamp_idx ON events (session_id, timestamp);
CREATE INDEX events_type_timestamp_idx ON events (event_type, timestamp);
CREATE INDEX events_model_idx ON events (model);
CREATE INDEX events_local_date_idx ON events (local_date);
CREATE INDEX events_enrichment_idx ON events (enrichment_version, event_type);

CREATE TABLE prompts (
  event_id TEXT PRIMARY KEY NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  text TEXT,
  text_hash TEXT NOT NULL,
  normalized_hash TEXT NOT NULL,
  char_length INTEGER NOT NULL,
  word_length INTEGER NOT NULL,
  redaction_count INTEGER NOT NULL DEFAULT 0,
  preview TEXT
);
CREATE INDEX prompts_normalized_hash_idx ON prompts (normalized_hash);

CREATE TABLE responses (
  event_id TEXT PRIMARY KEY NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  text TEXT,
  char_length INTEGER NOT NULL,
  redaction_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE tool_calls (
  event_id TEXT PRIMARY KEY NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  succeeded INTEGER,
  duration_ms INTEGER,
  target_extension TEXT
);
CREATE INDEX tool_calls_name_idx ON tool_calls (tool_name);
CREATE INDEX tool_calls_session_idx ON tool_calls (session_id);

CREATE TABLE classifications (
  event_id TEXT PRIMARY KEY NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  confidence REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'heuristic',
  classifier_version INTEGER NOT NULL
);
CREATE INDEX classifications_category_idx ON classifications (category, event_id);

CREATE TABLE technologies (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  technology TEXT NOT NULL,
  confidence REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'heuristic',
  PRIMARY KEY (event_id, technology)
);
CREATE INDEX technologies_tech_idx ON technologies (technology, event_id);

CREATE TABLE contexts (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  context TEXT NOT NULL,
  confidence REAL NOT NULL,
  PRIMARY KEY (event_id, context)
);
CREATE INDEX contexts_context_idx ON contexts (context, event_id);

CREATE TABLE daily_rollups (
  day TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  project_id TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  prompts INTEGER NOT NULL DEFAULT 0,
  responses INTEGER NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (day, provider_id, project_id, model, category)
);
CREATE INDEX daily_rollups_day_idx ON daily_rollups (day);

CREATE TABLE daily_active (
  day TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  active_ms INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, provider_id)
);
CREATE INDEX daily_active_day_idx ON daily_active (day);

CREATE TABLE collector_state (
  provider_id TEXT NOT NULL,
  source_path TEXT NOT NULL,
  byte_offset INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL DEFAULT 0,
  mtime_ms INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT,
  line_count INTEGER NOT NULL DEFAULT 0,
  parse_errors INTEGER NOT NULL DEFAULT 0,
  last_scanned_at TEXT NOT NULL,
  PRIMARY KEY (provider_id, source_path)
);

CREATE TABLE ingest_log (
  batch_id TEXT PRIMARY KEY NOT NULL,
  provider_id TEXT NOT NULL,
  source TEXT NOT NULL,
  accepted INTEGER NOT NULL DEFAULT 0,
  deduped INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  parse_errors INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX ingest_log_started_idx ON ingest_log (started_at);

CREATE TABLE settings (
  key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE schema_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
