import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import type { EventFilters, ExportRow } from '@ai-footprint/database';
import { APP_NAME } from '@ai-footprint/shared';
import { StoreService } from '../common';

const CSV_COLUMNS: Array<keyof ExportRow> = [
  'id',
  'timestamp',
  'localDate',
  'tzOffsetMinutes',
  'eventType',
  'providerId',
  'model',
  'modelFamily',
  'sessionId',
  'projectId',
  'projectName',
  'repository',
  'gitBranch',
  'workingDirectory',
  'isSubagent',
  'category',
  'categoryConfidence',
  'technologies',
  'toolName',
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'estimatedCostUsd',
  'durationMs',
  'charLength',
  'redactionCount',
  'sourceVersion',
  'promptText',
];

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * Exports stream row by row. The corpus reaches millions of events, so buffering a full
 * JSON document would exhaust memory on exactly the histories worth exporting.
 */
@Injectable()
export class ExportService {
  constructor(private readonly stores: StoreService) {}

  streamJson(
    response: Response,
    filters: EventFilters,
    includePrompts: boolean,
    meta: Record<string, unknown>,
  ): void {
    const store = this.stores.store;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${this.fileName('json')}"`);

    const manifest = {
      application: APP_NAME,
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      includesPromptText: includePrompts,
      filters: meta,
      rowCounts: store.maintenance.tableCounts(),
    };

    response.write(`{"manifest":${JSON.stringify(manifest)},"events":[`);
    let first = true;
    for (const row of store.analytics.exportRows(filters, includePrompts)) {
      response.write(`${first ? '' : ','}${JSON.stringify(this.shape(row))}`);
      first = false;
    }
    response.end(']}');
  }

  streamCsv(response: Response, filters: EventFilters, includePrompts: boolean): void {
    const store = this.stores.store;
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${this.fileName('csv')}"`);

    response.write(`${CSV_COLUMNS.join(',')}\n`);
    for (const row of store.analytics.exportRows(filters, includePrompts)) {
      response.write(`${CSV_COLUMNS.map((column) => csvCell(row[column])).join(',')}\n`);
    }
    response.end();
  }

  private shape(row: ExportRow): Record<string, unknown> {
    return {
      ...row,
      isSubagent: row.isSubagent === 1,
      technologies: row.technologies ? row.technologies.split(',') : [],
    };
  }

  private fileName(extension: string): string {
    const stamp = new Date().toISOString().slice(0, 10);
    return `ai-footprint-export-${stamp}.${extension}`;
  }
}
