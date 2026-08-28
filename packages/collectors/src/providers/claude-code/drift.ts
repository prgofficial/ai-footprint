import { TRACKED_FIELDS, type TranscriptRecord, type TrackedField } from './records';

/**
 * Plan §2.1 accepts that the transcript format is internal and can change. This watches
 * field coverage while parsing so a change surfaces as a visible warning rather than as
 * silently missing analytics.
 */
export class DriftDetector {
  private readonly present = new Map<TrackedField, number>();
  private readonly applicable = new Map<TrackedField, number>();

  observe(record: TranscriptRecord): void {
    this.count('timestamp', true, Boolean(record.timestamp));
    this.count('sessionId', true, Boolean(record.sessionId));
    this.count('uuid', true, Boolean(record.uuid));
    this.count('cwd', true, Boolean(record.cwd));
    this.count('version', true, Boolean(record.version));

    const isAssistant = record.type === 'assistant';
    this.count('message.model', isAssistant, Boolean(record.message?.model));
    this.count('message.usage', isAssistant, Boolean(record.message?.usage));
  }

  private count(field: TrackedField, applicable: boolean, present: boolean): void {
    if (!applicable) return;
    this.applicable.set(field, (this.applicable.get(field) ?? 0) + 1);
    if (present) this.present.set(field, (this.present.get(field) ?? 0) + 1);
  }

  coverage(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const field of TRACKED_FIELDS) {
      const total = this.applicable.get(field) ?? 0;
      out[field] = total === 0 ? 1 : (this.present.get(field) ?? 0) / total;
    }
    return out;
  }

  warnings(minimumSample = 50): string[] {
    const messages: string[] = [];
    for (const field of TRACKED_FIELDS) {
      const total = this.applicable.get(field) ?? 0;
      if (total < minimumSample) continue;
      const ratio = (this.present.get(field) ?? 0) / total;
      if (ratio < 0.5) {
        messages.push(
          `Claude Code no longer reports "${field}" in most records — some metrics may be incomplete. Updating AI Footprint usually fixes this.`,
        );
      }
    }
    return messages;
  }

  reset(): void {
    this.present.clear();
    this.applicable.clear();
  }
}
