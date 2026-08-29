import { Injectable } from '@nestjs/common';

/**
 * better-sqlite3 is synchronous, so every background worker shares one thread with request
 * handling. During a large import the importer gets the database to itself; everything else
 * waits rather than competing for it.
 */
@Injectable()
export class BusyState {
  private readonly importing = new Set<string>();

  beginImport(providerId: string): void {
    this.importing.add(providerId);
  }

  endImport(providerId: string): void {
    this.importing.delete(providerId);
  }

  get isImporting(): boolean {
    return this.importing.size > 0;
  }

  isImportingProvider(providerId: string): boolean {
    return this.importing.has(providerId);
  }
}
