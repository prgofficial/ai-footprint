import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const MINIMUM_NODE = 20;

export function detectPlatform() {
  switch (platform()) {
    case 'darwin':
      return 'macOS';
    case 'linux':
      return 'Linux';
    case 'win32':
      return 'Windows';
    default:
      return platform();
  }
}

export function nodeMajor() {
  return Number.parseInt(process.versions.node.split('.')[0], 10);
}

export function appDirectory(env = process.env) {
  if (env.AI_FOOTPRINT_HOME) return env.AI_FOOTPRINT_HOME;
  if (platform() === 'win32') {
    return join(env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'ai-footprint');
  }
  return join(homedir(), '.ai-footprint');
}

export function ensureAppDirectory(root = appDirectory()) {
  for (const name of ['data', 'logs', 'cache', 'config', 'backups']) {
    mkdirSync(join(root, name), { recursive: true, mode: 0o700 });
  }
  return root;
}

/** Arguments are always an array and the shell is never involved (brief 34). */
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.quiet ? 'pipe' : 'inherit',
    encoding: 'utf8',
    shell: false,
    ...options,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout ?? '').toString().trim(),
    stderr: (result.stderr ?? '').toString().trim(),
    error: result.error,
  };
}

export function spawnStreaming(command, args, options = {}) {
  return spawn(command, args, { stdio: 'inherit', shell: false, ...options });
}

export function commandExists(command) {
  const probe = platform() === 'win32' ? 'where' : 'which';
  return run(probe, [command], { quiet: true }).ok;
}

export function isPortFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen({ port, host, exclusive: true });
  });
}

export async function findFreePort(preferred, attempts = 50) {
  for (let index = 0; index < attempts; index++) {
    const candidate = preferred + index;
    if (candidate > 65535) break;
    if (await isPortFree(candidate)) return candidate;
  }
  return null;
}

export async function waitForHealth(url, { timeoutMs = 120_000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return await response.json();
    } catch {
      // Not up yet; keep waiting until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

export function dockerAvailable() {
  if (!commandExists('docker')) return { available: false, reason: 'Docker is not installed.' };
  const info = run('docker', ['info', '--format', '{{.ServerVersion}}'], { quiet: true });
  if (!info.ok) {
    return { available: false, reason: 'Docker is installed but the daemon is not running.' };
  }
  return { available: true, version: info.stdout };
}

/**
 * The uid/gid the container should run as, so it can write the bind-mounted data directory.
 * Windows has no uids and Docker Desktop remaps ownership anyway, so there it stays unset and
 * the stack file's default applies.
 */
export function hostUserIds() {
  if (typeof process.getuid !== 'function' || typeof process.getgid !== 'function') return {};
  return { AI_FOOTPRINT_UID: String(process.getuid()), AI_FOOTPRINT_GID: String(process.getgid()) };
}

export function swarmActive() {
  const result = run('docker', ['info', '--format', '{{.Swarm.LocalNodeState}}'], { quiet: true });
  return result.ok && result.stdout === 'active';
}

export function repoRoot() {
  return fileURLToPath(new URL('../..', import.meta.url));
}

export function buildArtifactsExist(root) {
  return (
    existsSync(join(root, 'apps', 'web', 'dist', 'index.html')) &&
    existsSync(join(root, 'apps', 'api', 'dist', 'main.js'))
  );
}

export function npmCommand() {
  return platform() === 'win32' ? 'npm.cmd' : 'npm';
}
