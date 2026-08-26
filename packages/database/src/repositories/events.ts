import type { SqliteConnection } from '../client';
import type { IngestOutcome, IngestRecord } from '../types';

const INSERT_EVENT = `
INSERT INTO events (
  id, dedupe_key, provider_id, product, model, model_family, timestamp, tz_offset_minutes,
  local_date, local_hour, local_weekday, session_id, external_id, parent_event_id, is_subagent,
  project_id, working_directory, repository, git_branch, event_type,
  input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, estimated_cost_usd,
  duration_ms, source_version, ingest_version, enrichment_version, metadata_json, created_at
) VALUES (
  @id, @dedupeKey, @providerId, @product, @model, @modelFamily, @timestamp, @tzOffsetMinutes,
  @localDate, @localHour, @localWeekday, @sessionId, @externalId, @parentEventId, @isSubagent,
  @projectId, @workingDirectory, @repository, @gitBranch, @eventType,
  @inputTokens, @outputTokens, @cacheReadTokens, @cacheWriteTokens, @estimatedCostUsd,
  @durationMs, @sourceVersion, @ingestVersion, 0, @metadataJson, @createdAt
)
ON CONFLICT (dedupe_key) DO NOTHING
RETURNING id`;

/**
 * G2: a re-scan, a hook retry, a crash mid-backfill and a stack redeploy must all be safe.
 * Insert is keyed on the deterministic dedupe key; a conflict updates only the columns that
 * can legitimately improve on a second sighting, and never duplicates a row.
 */
const REFRESH_EVENT = `
UPDATE events SET
  model = COALESCE(@model, model),
  model_family = COALESCE(@modelFamily, model_family),
  session_id = COALESCE(@sessionId, session_id),
  project_id = COALESCE(@projectId, project_id),
  input_tokens = COALESCE(@inputTokens, input_tokens),
  output_tokens = COALESCE(@outputTokens, output_tokens),
  cache_read_tokens = COALESCE(@cacheReadTokens, cache_read_tokens),
  cache_write_tokens = COALESCE(@cacheWriteTokens, cache_write_tokens),
  estimated_cost_usd = COALESCE(@estimatedCostUsd, estimated_cost_usd),
  duration_ms = COALESCE(@durationMs, duration_ms),
  git_branch = COALESCE(@gitBranch, git_branch),
  repository = COALESCE(@repository, repository)
WHERE dedupe_key = @dedupeKey AND ingest_version <= @ingestVersion`;

const INSERT_PROMPT = `
INSERT INTO prompts (event_id, text, text_hash, normalized_hash, char_length, word_length, redaction_count, preview)
VALUES (@eventId, @text, @textHash, @normalizedHash, @charLength, @wordLength, @redactionCount, @preview)
ON CONFLICT (event_id) DO NOTHING`;

const INSERT_RESPONSE = `
INSERT INTO responses (event_id, text, char_length, redaction_count)
VALUES (@eventId, @text, @charLength, @redactionCount)
ON CONFLICT (event_id) DO NOTHING`;

const INSERT_TOOL_CALL = `
INSERT INTO tool_calls (event_id, session_id, tool_name, succeeded, duration_ms, target_extension)
VALUES (@eventId, @sessionId, @toolName, @succeeded, @durationMs, @targetExtension)
ON CONFLICT (event_id) DO UPDATE SET
  succeeded = COALESCE(excluded.succeeded, tool_calls.succeeded)`;

export class EventRepository {
  private readonly insertEvent;
  private readonly refreshEvent;
  private readonly insertPrompt;
  private readonly insertResponse;
  private readonly insertToolCall;

  constructor(private readonly connection: SqliteConnection) {
    this.insertEvent = connection.prepare(INSERT_EVENT);
    this.refreshEvent = connection.prepare(REFRESH_EVENT);
    this.insertPrompt = connection.prepare(INSERT_PROMPT);
    this.insertResponse = connection.prepare(INSERT_RESPONSE);
    this.insertToolCall = connection.prepare(INSERT_TOOL_CALL);
  }

  ingestBatch(records: IngestRecord[]): IngestOutcome {
    const outcome: IngestOutcome = {
      accepted: 0,
      deduped: 0,
      failed: 0,
      acceptedIds: [],
      touchedDays: [],
    };
    const days = new Set<string>();
    const createdAt = new Date().toISOString();

    const run = this.connection.transaction((batch: IngestRecord[]) => {
      for (const record of batch) {
        const { event } = record;
        const params = {
          ...event,
          isSubagent: event.isSubagent ? 1 : 0,
          createdAt,
        };
        let inserted: { id: string } | undefined;
        try {
          inserted = this.insertEvent.get(params) as { id: string } | undefined;
        } catch {
          outcome.failed += 1;
          continue;
        }

        if (!inserted) {
          this.refreshEvent.run(params);
          outcome.deduped += 1;
          continue;
        }

        outcome.accepted += 1;
        outcome.acceptedIds.push(event.id);
        days.add(`${event.localDate}|${event.providerId}`);

        if (record.prompt) {
          this.insertPrompt.run({ eventId: event.id, ...record.prompt });
        }
        if (record.response) {
          this.insertResponse.run({ eventId: event.id, ...record.response });
        }
        if (record.toolCall) {
          this.insertToolCall.run({
            eventId: event.id,
            sessionId: event.sessionId,
            ...record.toolCall,
            succeeded:
              record.toolCall.succeeded === null || record.toolCall.succeeded === undefined
                ? null
                : record.toolCall.succeeded
                  ? 1
                  : 0,
          });
        }
      }
    });

    run(records);

    outcome.touchedDays = [...days].map((key) => {
      const [day, providerId] = key.split('|');
      return { day: day as string, providerId: providerId as string };
    });
    return outcome;
  }

  countAll(): number {
    const row = this.connection.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number };
    return row.n;
  }

  countForProvider(providerId: string): number {
    const row = this.connection
      .prepare('SELECT COUNT(*) AS n FROM events WHERE provider_id = ?')
      .get(providerId) as { n: number };
    return row.n;
  }

  lastEventAt(providerId: string): string | null {
    const row = this.connection
      .prepare('SELECT MAX(timestamp) AS t FROM events WHERE provider_id = ?')
      .get(providerId) as { t: string | null };
    return row.t;
  }

  firstEventAt(): string | null {
    const row = this.connection.prepare('SELECT MIN(timestamp) AS t FROM events').get() as {
      t: string | null;
    };
    return row.t;
  }

  existingDedupeKeys(keys: string[]): Set<string> {
    if (keys.length === 0) return new Set();
    const found = new Set<string>();
    const chunkSize = 400;
    for (let i = 0; i < keys.length; i += chunkSize) {
      const chunk = keys.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = this.connection
        .prepare(`SELECT dedupe_key FROM events WHERE dedupe_key IN (${placeholders})`)
        .all(...chunk) as Array<{ dedupe_key: string }>;
      for (const row of rows) found.add(row.dedupe_key);
    }
    return found;
  }

  raw(): SqliteConnection {
    return this.connection;
  }
}
