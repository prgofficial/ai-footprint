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
 * G2: re-scans, hook retries and crashed backfills must all be safe. Keyed on the deterministic
 * dedupe key; a conflict only fills columns the stored row still lacks. The stored value always
 * wins, or a collision rewrites the survivor's model, tokens, session and project.
 */
const REFRESH_EVENT = `
UPDATE events SET
  model = COALESCE(model, @model),
  model_family = COALESCE(model_family, @modelFamily),
  session_id = COALESCE(session_id, @sessionId),
  project_id = COALESCE(project_id, @projectId),
  input_tokens = COALESCE(input_tokens, @inputTokens),
  output_tokens = COALESCE(output_tokens, @outputTokens),
  cache_read_tokens = COALESCE(cache_read_tokens, @cacheReadTokens),
  cache_write_tokens = COALESCE(cache_write_tokens, @cacheWriteTokens),
  estimated_cost_usd = COALESCE(estimated_cost_usd, @estimatedCostUsd),
  duration_ms = COALESCE(duration_ms, @durationMs),
  git_branch = COALESCE(git_branch, @gitBranch),
  repository = COALESCE(repository, @repository)
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

/**
 * Transcripts stamp the model on the reply, never on the prompt, so prompts land with none and
 * the dedupe key stops a re-scan correcting it. Attribute each to the first reply after it in
 * the same session and on the same side of a subagent boundary, skipping `<synthetic>`.
 * Unanswered prompts keep their null.
 *
 * INDEXED BY pins the partial index of unlinked prompts. Left to choose, the planner walks
 * every prompt in the session and a watch scan costs 400ms instead of 4ms.
 */
const LINK_PROMPT_MODELS = (placeholders: string): string => `
UPDATE events
   SET model = a.model, model_family = a.model_family
  FROM (
    SELECT p.id AS pid, r.model AS model, r.model_family AS model_family
      FROM events p INDEXED BY events_unlinked_prompt_idx
      JOIN events r ON r.id = (
        SELECT r2.id FROM events r2
         WHERE r2.session_id = p.session_id
           AND r2.is_subagent = p.is_subagent
           AND r2.event_type = 'response'
           AND r2.model IS NOT NULL
           AND r2.model NOT LIKE '<%'
           AND r2.timestamp >= p.timestamp
         ORDER BY r2.timestamp
         LIMIT 1)
     WHERE p.event_type = 'prompt' AND p.model IS NULL AND p.session_id IN (${placeholders})
  ) AS a
 WHERE events.id = a.pid
 RETURNING events.local_date AS day, events.provider_id AS providerId`;

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
          // A refresh can fill a column that was null, and the rollups summarise those
          // columns. Marking the day dirty is far cheaper than letting them drift.
          days.add(`${event.localDate}|${event.providerId}`);
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

  /**
   * Attributes any still-unattributed prompt in these sessions to the model that answered it.
   * Returns the days it changed so the caller can rebuild their rollups: a reply can land on
   * the far side of midnight from the prompt it answers.
   */
  linkPromptModels(sessionIds: string[]): Array<{ day: string; providerId: string }> {
    if (sessionIds.length === 0) return [];
    const rows = this.connection
      .prepare(LINK_PROMPT_MODELS(sessionIds.map(() => '?').join(', ')))
      .all(...sessionIds) as Array<{ day: string; providerId: string }>;

    const days = new Map<string, { day: string; providerId: string }>();
    for (const row of rows) days.set(`${row.day}|${row.providerId}`, row);
    return [...days.values()];
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
