import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  hooksInstalled,
  installHooks,
  mergeHooks,
  readSettings,
  removeHooks,
  uninstallHooks,
} from '../src/providers/claude-code/hooks';

/**
 * Reproduces the shape found on a real machine: three pre-existing hooks pointing at a
 * personal notifier, tagged with their own marker. These must survive install and uninstall
 * byte-for-byte (F4/G4).
 */
const EXISTING = {
  model: 'opus',
  attribution: false,
  effortLevel: 'high',
  hooks: {
    Notification: [
      {
        matcher: 'permission_prompt|elicitation_dialog|idle_prompt',
        hooks: [
          {
            type: 'command',
            command: 'node "/home/example/.claude/notify.js" # claude-code-notifier',
          },
        ],
      },
    ],
    Stop: [
      {
        hooks: [
          {
            type: 'command',
            command: 'node "/home/example/.claude/notify.js" # claude-code-notifier',
          },
        ],
      },
    ],
    SubagentStop: [
      {
        hooks: [
          {
            type: 'command',
            command: 'node "/home/example/.claude/notify.js" # claude-code-notifier',
          },
        ],
      },
    ],
  },
};

let dir: string;
let settingsPath: string;
let backupDir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'af-hooks-'));
  settingsPath = join(dir, 'settings.json');
  backupDir = join(dir, 'backups');
  writeFileSync(settingsPath, `${JSON.stringify(EXISTING, null, 2)}\n`);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('hook installer', () => {
  it("leaves the user's existing hooks and unrelated settings untouched", () => {
    installHooks({ settingsPath, backupDir, port: 4173, token: 'tok' });
    const after = readSettings(settingsPath);

    expect(after.model).toBe('opus');
    expect(after.effortLevel).toBe('high');
    expect(after.hooks?.Notification).toEqual(EXISTING.hooks.Notification);
    expect(after.hooks?.Stop).toEqual(EXISTING.hooks.Stop);
    expect(after.hooks?.SubagentStop).toEqual(EXISTING.hooks.SubagentStop);
  });

  it('installs an http hook carrying the ingest token', () => {
    installHooks({ settingsPath, backupDir, port: 4173, token: 'tok-123' });
    const entry = readSettings(settingsPath).hooks?.UserPromptSubmit?.[0]?.hooks?.[0];
    expect(entry?.type).toBe('http');
    expect(entry?.url).toBe('http://127.0.0.1:4173/api/ingest/hook');
    expect(entry?.headers?.['x-ai-footprint-token']).toBe('tok-123');
  });

  it('backs the original up before writing', () => {
    installHooks({ settingsPath, backupDir, port: 4173, token: 'tok' });
    const backups = readdirSync(backupDir);
    expect(backups).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(backupDir, backups[0] as string), 'utf8'))).toEqual(
      EXISTING,
    );
  });

  it('is idempotent: installing twice leaves one entry per event', () => {
    installHooks({ settingsPath, backupDir, port: 4173, token: 'tok' });
    installHooks({ settingsPath, backupDir, port: 4173, token: 'tok' });
    const hooks = readSettings(settingsPath).hooks?.SessionStart ?? [];
    expect(hooks).toHaveLength(1);
    expect(hooks[0]?.hooks).toHaveLength(1);
  });

  it('uninstall restores the file to exactly what it was', () => {
    const before = readFileSync(settingsPath, 'utf8');
    installHooks({ settingsPath, backupDir, port: 4173, token: 'tok' });
    expect(hooksInstalled(readSettings(settingsPath))).toBe(true);

    uninstallHooks(settingsPath, backupDir);
    expect(hooksInstalled(readSettings(settingsPath))).toBe(false);
    expect(readSettings(settingsPath)).toEqual(JSON.parse(before));
  });

  it('uninstall keeps a user hook that shares an event with ours', () => {
    const shared = {
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'echo mine # personal' }] }],
      },
    };
    const merged = mergeHooks(shared, 4173, 'tok');
    expect(merged.hooks?.SessionStart).toHaveLength(2);

    const cleaned = removeHooks(merged);
    expect(cleaned.hooks?.SessionStart).toEqual(shared.hooks.SessionStart);
  });

  it('refuses to touch a settings file it cannot parse', () => {
    writeFileSync(settingsPath, '{ not json');
    expect(() => installHooks({ settingsPath, backupDir, port: 4173, token: 'tok' })).toThrow(
      /could not be parsed/,
    );
    expect(readFileSync(settingsPath, 'utf8')).toBe('{ not json');
  });

  it('creates settings from nothing when the user has none', () => {
    rmSync(settingsPath);
    installHooks({ settingsPath, backupDir, port: 4200, token: 'tok' });
    expect(hooksInstalled(readSettings(settingsPath))).toBe(true);
    uninstallHooks(settingsPath, backupDir);
    expect(readSettings(settingsPath)).toEqual({});
  });
});
