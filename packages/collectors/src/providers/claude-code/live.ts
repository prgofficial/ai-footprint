import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { claudeHome } from '@ai-footprint/config';

/**
 * A Claude Code session running right now. One JSON file per live process in
 * `~/.claude/sessions`, removed when the process exits. A local directory read: nothing is
 * written, and the pid is only checked for liveness.
 */
export interface LiveSession {
  /** Claude Code's own session id, which matches `sessionId` on the transcript events. */
  externalId: string;
  pid: number;
  /** The user's name for the session when they set one, otherwise null. */
  name: string | null;
  workingDirectory: string | null;
  startedAt: string | null;
  /** `interactive`, or whatever Claude Code reports for a background or piped run. */
  kind: string | null;
  /** Where it was launched from: `claude-vscode`, a terminal, a hook. */
  entrypoint: string | null;
  version: string | null;
}

/** True when the process still exists. Signal 0 checks for liveness without disturbing it. */
function isRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else, which still counts as alive.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readSession(path: string): LiveSession | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }

  const pid = typeof raw.pid === 'number' ? raw.pid : 0;
  const externalId = typeof raw.sessionId === 'string' ? raw.sessionId : null;
  if (!externalId || !isRunning(pid)) return null;

  const startedAtMs = typeof raw.startedAt === 'number' ? raw.startedAt : null;
  return {
    externalId,
    pid,
    name: typeof raw.name === 'string' && raw.name ? raw.name : null,
    workingDirectory: typeof raw.cwd === 'string' ? raw.cwd : null,
    startedAt: startedAtMs ? new Date(startedAtMs).toISOString() : null,
    kind: typeof raw.kind === 'string' ? raw.kind : null,
    entrypoint: typeof raw.entrypoint === 'string' ? raw.entrypoint : null,
    version: typeof raw.version === 'string' ? raw.version : null,
  };
}

/**
 * Every Claude Code session running on this machine, newest first. Empty when the directory does
 * not exist, which is simply what an older Claude Code, or none at all, looks like.
 */
export function listLiveSessions(home = claudeHome()): LiveSession[] {
  let entries: string[];
  try {
    entries = readdirSync(join(home, 'sessions'));
  } catch {
    return [];
  }

  const sessions: LiveSession[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const path = join(home, 'sessions', entry);
    try {
      if (!statSync(path).isFile()) continue;
    } catch {
      continue;
    }
    const session = readSession(path);
    if (session) sessions.push(session);
  }

  return sessions.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
}
