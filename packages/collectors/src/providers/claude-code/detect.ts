import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { DetectionResult } from '@ai-footprint/shared';
import { listTranscriptFiles } from './transcript-reader';

export interface ClaudeLocations {
  home: string;
  projectsDir: string;
  settingsPath: string;
}

export function claudeLocations(home: string): ClaudeLocations {
  return {
    home,
    projectsDir: join(home, 'projects'),
    settingsPath: join(home, 'settings.json'),
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[index]}`;
}

export function detectClaudeCode(home: string): DetectionResult {
  const locations = claudeLocations(home);
  if (!existsSync(locations.home)) {
    return {
      detected: false,
      message: 'Claude Code was not found on this machine.',
    };
  }

  if (!existsSync(locations.projectsDir)) {
    return {
      detected: true,
      message: 'Claude Code is installed, but it has not recorded any sessions yet.',
      details: { projects: 0, historyBytes: 0 },
    };
  }

  const files = listTranscriptFiles(locations.projectsDir);
  const bytes = files.reduce((total, file) => total + file.size, 0);
  let projectCount = 0;
  try {
    projectCount = readdirSync(locations.projectsDir, { withFileTypes: true }).filter((entry) =>
      entry.isDirectory(),
    ).length;
  } catch {
    projectCount = 0;
  }

  const version = latestVersionSeen(files.map((f) => f.path));

  return {
    detected: true,
    version,
    message:
      files.length === 0
        ? 'Claude Code is installed, but it has not recorded any sessions yet.'
        : `Detected — ${projectCount} project${projectCount === 1 ? '' : 's'} and ${files.length} sessions, ${formatBytes(bytes)} of history available to import.`,
    details: {
      projects: projectCount,
      sessions: files.length,
      historyBytes: bytes,
      historyLabel: formatBytes(bytes),
    },
  };
}

/** Reads the `version` field from the most recent transcript rather than shelling out, so
 *  detection needs no child process and works when the CLI is not on PATH. */
function latestVersionSeen(paths: string[]): string | null {
  const newest = paths
    .map((path) => {
      try {
        return { path, mtimeMs: statSync(path).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { path: string; mtimeMs: number } => entry !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];

  if (!newest) return null;
  let fd: number | null = null;
  try {
    fd = openSync(newest.path, 'r');
    const buffer = Buffer.alloc(20_000);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    const match = /"version"\s*:\s*"([^"]+)"/.exec(buffer.subarray(0, bytesRead).toString('utf8'));
    return match?.[1] ?? null;
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // Descriptor already gone.
      }
    }
  }
}
