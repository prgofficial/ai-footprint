import { platform } from 'node:os';

export type Platform = 'macos' | 'linux' | 'windows' | 'other';

export function currentPlatform(): Platform {
  switch (platform()) {
    case 'darwin':
      return 'macos';
    case 'linux':
      return 'linux';
    case 'win32':
      return 'windows';
    default:
      return 'other';
  }
}

export function isDockerRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AI_FOOTPRINT_MODE === 'docker';
}

export function resolveTimezone(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.AI_FOOTPRINT_TZ?.trim();
  if (override) return override;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function appVersion(): string {
  return process.env.AI_FOOTPRINT_VERSION ?? '1.0.0';
}
