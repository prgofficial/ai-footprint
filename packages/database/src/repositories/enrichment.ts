import type { SqliteConnection } from '../client';

export interface EnrichmentInput {
  eventId: string;
  category: string;
  confidence: number;
  source: 'heuristic' | 'user';
  classifierVersion: number;
  technologies: Array<{ technology: string; confidence: number }>;
  contexts: Array<{ context: string; confidence: number }>;
  enrichmentVersion: number;
}

export interface PendingEnrichmentRow {
  id: string;
  eventType: string;
  text: string | null;
  model: string | null;
  projectId: string | null;
  sessionId: string | null;
  timestamp: string;
  workingDirectory: string | null;
  toolNames: string | null;
}

export class EnrichmentRepository {
  private readonly upsertClassification;
  private readonly deleteTechnologies;
  private readonly insertTechnology;
  private readonly deleteContexts;
  private readonly insertContext;
  private readonly markEnriched;

  constructor(private readonly connection: SqliteConnection) {
    this.upsertClassification = connection.prepare(`
      INSERT INTO classifications (event_id, category, confidence, source, classifier_version)
      VALUES (@eventId, @category, @confidence, @source, @classifierVersion)
      ON CONFLICT (event_id) DO UPDATE SET
        category = excluded.category,
        confidence = excluded.confidence,
        source = excluded.source,
        classifier_version = excluded.classifier_version
      WHERE classifications.source != 'user' OR excluded.source = 'user'`);
    this.deleteTechnologies = connection.prepare(
      "DELETE FROM technologies WHERE event_id = ? AND source = 'heuristic'",
    );
    this.insertTechnology = connection.prepare(`
      INSERT INTO technologies (event_id, technology, confidence, source)
      VALUES (?, ?, ?, 'heuristic')
      ON CONFLICT (event_id, technology) DO UPDATE SET confidence = excluded.confidence`);
    this.deleteContexts = connection.prepare('DELETE FROM contexts WHERE event_id = ?');
    this.insertContext = connection.prepare(`
      INSERT INTO contexts (event_id, context, confidence) VALUES (?, ?, ?)
      ON CONFLICT (event_id, context) DO UPDATE SET confidence = excluded.confidence`);
    this.markEnriched = connection.prepare('UPDATE events SET enrichment_version = ? WHERE id = ?');
  }

  /**
   * Brief §20: unchanged events must not be reprocessed. Selection is driven by the stored
   * enrichment version, so bumping the version reprocesses exactly the affected rows.
   */
  pending(currentVersion: number, limit: number): PendingEnrichmentRow[] {
    return this.connection
      .prepare(
        `SELECT e.id, e.event_type AS eventType, p.text, e.model, e.project_id AS projectId,
                e.session_id AS sessionId, e.timestamp, e.working_directory AS workingDirectory,
                (SELECT GROUP_CONCAT(tc.tool_name)
                   FROM tool_calls tc
                   JOIN events te ON te.id = tc.event_id
                  WHERE te.session_id = e.session_id
                    AND te.timestamp > e.timestamp
                    AND te.timestamp <= datetime(e.timestamp, '+5 minutes')
                ) AS toolNames
           FROM events e
           LEFT JOIN prompts p ON p.event_id = e.id
          WHERE e.enrichment_version < ? AND e.event_type = 'prompt'
          ORDER BY e.timestamp
          LIMIT ?`,
      )
      .all(currentVersion, limit) as PendingEnrichmentRow[];
  }

  pendingCount(currentVersion: number): number {
    const row = this.connection
      .prepare(
        "SELECT COUNT(*) AS n FROM events WHERE enrichment_version < ? AND event_type = 'prompt'",
      )
      .get(currentVersion) as { n: number };
    return row.n;
  }

  apply(results: EnrichmentInput[]): void {
    if (results.length === 0) return;
    const run = this.connection.transaction((batch: EnrichmentInput[]) => {
      for (const result of batch) {
        this.upsertClassification.run({
          eventId: result.eventId,
          category: result.category,
          confidence: result.confidence,
          source: result.source,
          classifierVersion: result.classifierVersion,
        });
        this.deleteTechnologies.run(result.eventId);
        for (const tech of result.technologies) {
          this.insertTechnology.run(result.eventId, tech.technology, tech.confidence);
        }
        this.deleteContexts.run(result.eventId);
        for (const ctx of result.contexts) {
          this.insertContext.run(result.eventId, ctx.context, ctx.confidence);
        }
        this.markEnriched.run(result.enrichmentVersion, result.eventId);
      }
    });
    run(results);
  }

  override(eventId: string, category: string, contexts: string[], classifierVersion: number): void {
    const run = this.connection.transaction(() => {
      this.upsertClassification.run({
        eventId,
        category,
        confidence: 1,
        source: 'user',
        classifierVersion,
      });
      if (contexts.length > 0) {
        this.deleteContexts.run(eventId);
        for (const context of contexts) this.insertContext.run(eventId, context, 1);
      }
    });
    run();
  }

  resetVersions(): void {
    this.connection.prepare('UPDATE events SET enrichment_version = 0').run();
  }
}
