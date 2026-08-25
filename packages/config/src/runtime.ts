import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { getAppPaths, type AppPaths } from './paths';

export interface RuntimeConfig {
  version: number;
  port: number;
  host: string;
  ingestToken: string;
  mode: 'native' | 'docker';
  startedAt: string;
  stoppedAt?: string | null;
  pid: number;
  dataDirectory: string;
  databasePath: string;
}

const RUNTIME_VERSION = 1;

export function generateIngestToken(): string {
  return randomBytes(24).toString('base64url');
}

export function readRuntimeConfig(paths: AppPaths = getAppPaths()): RuntimeConfig | null {
  if (!existsSync(paths.runtimeConfig)) return null;
  try {
    const parsed = JSON.parse(readFileSync(paths.runtimeConfig, 'utf8')) as RuntimeConfig;
    if (parsed.version !== RUNTIME_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Written atomically and 0600: it carries the ingest token that guards local ingestion. */
export function writeRuntimeConfig(
  config: Omit<RuntimeConfig, 'version'>,
  paths: AppPaths = getAppPaths(),
): RuntimeConfig {
  const full: RuntimeConfig = { version: RUNTIME_VERSION, ...config };
  const tmp = `${paths.runtimeConfig}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(full, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, paths.runtimeConfig);
  try {
    chmodSync(paths.runtimeConfig, 0o600);
  } catch {
    // Windows does not implement POSIX modes; the file inherits the user profile ACL.
  }
  return full;
}

/**
 * The file survives shutdown on purpose. It carries the ingest token, and a Claude Code hook
 * embeds that token in the user's settings.json; regenerating it on every restart would
 * silently break realtime collection. Shutdown only records that the process stopped.
 */
export function markRuntimeStopped(paths: AppPaths = getAppPaths()): void {
  const existing = readRuntimeConfig(paths);
  if (!existing) return;
  try {
    writeRuntimeConfig({ ...existing, stoppedAt: new Date().toISOString() }, paths);
  } catch {
    // A stale runtime file is harmless; the next start overwrites it.
  }
}

/** Reuses the existing token when one is present so hooks installed earlier keep working. */
export function resolveIngestToken(paths: AppPaths = getAppPaths()): string {
  const existing = readRuntimeConfig(paths);
  if (existing?.ingestToken) return existing.ingestToken;
  return generateIngestToken();
}
