import { homedir, platform } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { mkdirSync } from 'node:fs';
import { APP_DIR_NAME } from '@ai-footprint/shared';

export interface AppPaths {
  root: string;
  data: string;
  database: string;
  logs: string;
  cache: string;
  config: string;
  backups: string;
  runtimeConfig: string;
}

/**
 * Windows keeps per-user application state under %APPDATA%; everywhere else the
 * dotted home directory is the convention. Never inside the repository (brief §6).
 */
export function resolveAppRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.AI_FOOTPRINT_HOME?.trim();
  if (override) return resolve(override);

  if (platform() === 'win32') {
    const appData = env.APPDATA?.trim();
    if (appData) return join(appData, APP_DIR_NAME);
    return join(homedir(), 'AppData', 'Roaming', APP_DIR_NAME);
  }
  return join(homedir(), `.${APP_DIR_NAME}`);
}

export function getAppPaths(env: NodeJS.ProcessEnv = process.env): AppPaths {
  const root = resolveAppRoot(env);
  const data = join(root, 'data');
  const config = join(root, 'config');
  return {
    root,
    data,
    database: join(data, 'app.db'),
    logs: join(root, 'logs'),
    cache: join(root, 'cache'),
    config,
    backups: join(root, 'backups'),
    runtimeConfig: join(config, 'runtime.json'),
  };
}

export function ensureAppDirectories(paths: AppPaths = getAppPaths()): AppPaths {
  for (const dir of [
    paths.root,
    paths.data,
    paths.logs,
    paths.cache,
    paths.config,
    paths.backups,
  ]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return paths;
}

/**
 * Every filesystem read driven by external data goes through this. Prevents a crafted
 * transcript path or project path from reaching outside its permitted root (brief §34).
 */
export function isPathInside(child: string, parent: string): boolean {
  const resolvedParent = resolve(parent);
  const resolvedChild = resolve(child);
  if (resolvedChild === resolvedParent) return true;
  const withSep = resolvedParent.endsWith(sep) ? resolvedParent : resolvedParent + sep;
  return resolvedChild.startsWith(withSep);
}

export function assertPathInside(child: string, parent: string): string {
  if (!isPathInside(child, parent)) {
    throw new Error('Path is outside the permitted directory');
  }
  return resolve(child);
}

export function claudeHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CLAUDE_CONFIG_DIR?.trim();
  if (override) return resolve(override);
  return join(homedir(), '.claude');
}
