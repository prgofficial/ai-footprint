import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getLogger } from '@ai-footprint/config';
import {
  detectContexts,
  detectTechnologies,
  HeuristicClassifier,
  technologiesFromManifest,
  type Classifier,
} from '@ai-footprint/analytics';
import type { EnrichmentInput } from '@ai-footprint/database';
import { ENRICHMENT_VERSION } from '@ai-footprint/shared';
import { BusyState } from '../common/busy.service';
import { StoreService } from '../common/store.service';

const BATCH_SIZE = 400;
const IDLE_INTERVAL_MS = 5_000;
/** Prompt text does not age by the minute; once every six hours is ample. */
const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MANIFESTS = [
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'Gemfile',
  'composer.json',
  'hardhat.config.ts',
  'hardhat.config.js',
  'foundry.toml',
];
const MAX_MANIFEST_BYTES = 512 * 1024;

/**
 * Brief §20: unchanged events must not be reprocessed. Work is selected by comparing the
 * event's stored enrichment version with the current one, so a re-run is a no-op and a
 * version bump reprocesses exactly the rows it affects.
 */
@Injectable()
export class EnrichmentService implements OnApplicationShutdown {
  private readonly logger = getLogger();
  private readonly projectTech = new Map<string, string[]>();
  private classifier: Classifier = new HeuristicClassifier();
  private timer: NodeJS.Timeout | null = null;
  private retentionTimer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    private readonly stores: StoreService,
    private readonly busy: BusyState,
  ) {}

  useClassifier(classifier: Classifier): void {
    this.classifier = classifier;
  }

  start(): void {
    void this.runUntilDrained();
    this.timer = setInterval(() => void this.runUntilDrained(), IDLE_INTERVAL_MS);
    this.timer.unref?.();

    // Settings offers to "automatically clear prompt text older than this", and nothing in the
    // product ever did. A user who set six months believed their old prompts were expiring.
    this.applyRetention();
    this.retentionTimer = setInterval(() => this.applyRetention(), RETENTION_INTERVAL_MS);
    this.retentionTimer.unref?.();
  }

  /** Clears prompt text past the configured age. A retention of zero keeps everything. */
  applyRetention(): number {
    const months = this.stores.settings().retentionMonths;
    if (!months || months <= 0) return 0;
    try {
      const cleared = this.stores.store.maintenance.applyRetention(months);
      if (cleared > 0) {
        this.logger.info({ cleared, months }, 'retention applied to stored prompt text');
      }
      return cleared;
    } catch (error) {
      this.logger.warn({ err: error }, 'retention pass failed');
      return 0;
    }
  }

  pending(): number {
    return this.stores.store.enrichment.pendingCount(ENRICHMENT_VERSION);
  }

  async runUntilDrained(maxBatches = 25): Promise<number> {
    if (this.running || this.stopped) return 0;
    // An import owns the database until it finishes; enrichment is never urgent.
    if (this.busy.isImporting) return 0;
    this.running = true;
    let processed = 0;
    try {
      for (let batch = 0; batch < maxBatches; batch++) {
        const count = this.runBatch();
        processed += count;
        if (count === 0) break;
        // Yield between batches so a large backlog never starves request handling.
        await new Promise((resolve) => setImmediate(resolve));
      }
    } catch (error) {
      this.logger.error({ err: error }, 'enrichment failed');
    } finally {
      this.running = false;
    }
    return processed;
  }

  runBatch(): number {
    const store = this.stores.store;
    const rows = store.enrichment.pending(ENRICHMENT_VERSION, BATCH_SIZE);
    if (rows.length === 0) return 0;

    const scanManifests = this.stores.settings().scanManifests;
    const results: EnrichmentInput[] = rows.map((row) => {
      const text = row.text ?? '';
      const toolNames = row.toolNames ? row.toolNames.split(',').filter(Boolean) : [];
      const classification = this.classifier.classify({ text, toolNames });

      const projectTechnologies = scanManifests
        ? this.technologiesForProject(row.projectId, row.workingDirectory)
        : [];
      const technologies = detectTechnologies({ text, projectTechnologies });
      const contexts = detectContexts({ text }, technologies);

      return {
        eventId: row.id,
        category: classification.category,
        confidence: classification.confidence,
        source: 'heuristic',
        classifierVersion: classification.version,
        technologies,
        contexts,
        enrichmentVersion: ENRICHMENT_VERSION,
      };
    });

    store.enrichment.apply(results);

    const touched = new Map<string, { day: string; providerId: string }>();
    for (const row of rows) {
      const event = store.connection
        .prepare('SELECT local_date AS day, provider_id AS providerId FROM events WHERE id = ?')
        .get(row.id) as { day: string; providerId: string } | undefined;
      if (event) touched.set(`${event.day}|${event.providerId}`, event);
    }
    if (touched.size > 0) store.rollups.rebuild([...touched.values()]);

    return rows.length;
  }

  /** Read-only, size-capped, and only under a directory that produced real events. */
  private technologiesForProject(
    projectId: string | null,
    workingDirectory: string | null,
  ): string[] {
    if (!projectId) return [];
    const cached = this.projectTech.get(projectId);
    if (cached) return cached;

    const project = this.stores.store.projects.get(projectId);
    const root = project?.path ?? workingDirectory;
    if (!root || !existsSync(root)) {
      this.projectTech.set(projectId, []);
      return [];
    }

    const found = new Set<string>();
    for (const manifest of MANIFESTS) {
      const path = join(root, manifest);
      try {
        if (!existsSync(path)) continue;
        if (statSync(path).size > MAX_MANIFEST_BYTES) continue;
        for (const technology of technologiesFromManifest(readFileSync(path, 'utf8'))) {
          found.add(technology);
        }
      } catch {
        // A manifest we cannot read simply contributes nothing.
      }
    }

    const technologies = [...found];
    this.projectTech.set(projectId, technologies);
    if (technologies.length > 0) this.stores.store.projects.setTechProfile(projectId, technologies);
    return technologies;
  }

  onApplicationShutdown(): void {
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }
}
