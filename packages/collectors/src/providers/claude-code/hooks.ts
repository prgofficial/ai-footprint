import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { INGEST_TOKEN_HEADER } from '@ai-footprint/shared';

/** Every entry AI Footprint writes carries this marker so disconnect can remove exactly its
 *  own and nothing else. `~/.claude/settings.json` on a real machine already holds other
 *  people's hooks (F4/G4). */
export const HOOK_MARKER = 'ai-footprint';

export const INSTALLED_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'SessionEnd',
  'PreCompact',
] as const;

interface HookCommand {
  type?: string;
  command?: string;
  url?: string;
  headers?: Record<string, string>;
  timeout?: number;
  [key: string]: unknown;
}

interface HookMatcher {
  matcher?: string;
  hooks?: HookCommand[];
  [key: string]: unknown;
}

export interface ClaudeSettings {
  hooks?: Record<string, HookMatcher[]>;
  [key: string]: unknown;
}

export interface HookInstallOptions {
  settingsPath: string;
  backupDir: string;
  port: number;
  token: string;
}

function isOurs(entry: HookCommand): boolean {
  if (entry[HOOK_MARKER] === true) return true;
  if (typeof entry.command === 'string' && entry.command.includes(`# ${HOOK_MARKER}`)) return true;
  if (typeof entry.url === 'string' && entry.url.includes('/api/ingest/hook')) return true;
  return false;
}

export function readSettings(settingsPath: string): ClaudeSettings {
  if (!existsSync(settingsPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as ClaudeSettings) : {};
  } catch {
    throw new Error('~/.claude/settings.json could not be parsed, so it was left untouched.');
  }
}

/** Temp file plus rename: a crash mid-write must not leave the user without Claude Code
 *  settings. The original is copied to our own backup directory first. */
export function writeSettings(
  settingsPath: string,
  settings: ClaudeSettings,
  backupDir?: string,
): void {
  if (backupDir && existsSync(settingsPath)) {
    mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    copyFileSync(settingsPath, join(backupDir, `claude-settings-${stamp}.json`));
  }
  mkdirSync(dirname(settingsPath), { recursive: true });
  const tmp = `${settingsPath}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  renameSync(tmp, settingsPath);
}

export function buildHookEntry(port: number, token: string, event: string): HookMatcher {
  return {
    hooks: [
      {
        type: 'http',
        url: `http://127.0.0.1:${port}/api/ingest/hook`,
        headers: { [INGEST_TOKEN_HEADER]: token, 'x-ai-footprint-event': event },
        timeout: 5,
        [HOOK_MARKER]: true,
      },
    ],
  };
}

export function mergeHooks(settings: ClaudeSettings, port: number, token: string): ClaudeSettings {
  const next: ClaudeSettings = { ...settings, hooks: { ...(settings.hooks ?? {}) } };
  const hooks = next.hooks as Record<string, HookMatcher[]>;

  for (const event of INSTALLED_EVENTS) {
    const existing = (hooks[event] ?? []).map((matcher) => ({
      ...matcher,
      hooks: (matcher.hooks ?? []).filter((entry) => !isOurs(entry)),
    }));
    const preserved = existing.filter((matcher) => (matcher.hooks ?? []).length > 0);
    hooks[event] = [...preserved, buildHookEntry(port, token, event)];
  }
  return next;
}

export function removeHooks(settings: ClaudeSettings): ClaudeSettings {
  if (!settings.hooks) return settings;
  const next: ClaudeSettings = { ...settings, hooks: { ...settings.hooks } };
  const hooks = next.hooks as Record<string, HookMatcher[]>;

  for (const [event, matchers] of Object.entries(hooks)) {
    const cleaned = matchers
      .map((matcher) => ({
        ...matcher,
        hooks: (matcher.hooks ?? []).filter((entry) => !isOurs(entry)),
      }))
      .filter((matcher) => (matcher.hooks ?? []).length > 0);
    if (cleaned.length === 0) {
      delete hooks[event];
    } else {
      hooks[event] = cleaned;
    }
  }
  if (Object.keys(hooks).length === 0) delete next.hooks;
  return next;
}

export function hooksInstalled(settings: ClaudeSettings): boolean {
  for (const matchers of Object.values(settings.hooks ?? {})) {
    for (const matcher of matchers) {
      if ((matcher.hooks ?? []).some(isOurs)) return true;
    }
  }
  return false;
}

export function installHooks(options: HookInstallOptions): void {
  const settings = readSettings(options.settingsPath);
  writeSettings(
    options.settingsPath,
    mergeHooks(settings, options.port, options.token),
    options.backupDir,
  );
}

export function uninstallHooks(settingsPath: string, backupDir: string): void {
  if (!existsSync(settingsPath)) return;
  const settings = readSettings(settingsPath);
  if (!hooksInstalled(settings)) return;
  writeSettings(settingsPath, removeHooks(settings), backupDir);
}
