import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, parse } from 'node:path';
import { createHash } from 'node:crypto';

export interface ResolvedProject {
  id: string;
  path: string;
  name: string;
  repository: string | null;
  gitRemote: string | null;
}

const GIT_URL = /url\s*=\s*(\S+)/;

function readGitRemote(gitDir: string): string | null {
  const configPath = join(gitDir, 'config');
  if (!existsSync(configPath)) return null;
  try {
    const config = readFileSync(configPath, 'utf8');
    const originIndex = config.indexOf('[remote "origin"]');
    if (originIndex < 0) return null;
    const section = config.slice(originIndex, originIndex + 500);
    return GIT_URL.exec(section)?.[1] ?? null;
  } catch {
    return null;
  }
}

function repositoryNameFrom(remote: string | null): string | null {
  if (!remote) return null;
  const cleaned = remote.replace(/\.git$/, '');
  const match = /[:/]([^/:]+\/[^/:]+)$/.exec(cleaned);
  return match?.[1] ?? null;
}

/**
 * §6.1: projects are inferred from the working directory by walking up to the nearest
 * repository root, so the user never tags anything by hand (brief §26).
 */
export function resolveProjectRoot(workingDirectory: string): string {
  let current = workingDirectory;
  const { root } = parse(workingDirectory);
  for (let depth = 0; depth < 40; depth++) {
    if (existsSync(join(current, '.git'))) return current;
    if (current === root) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return workingDirectory;
}

export function projectIdFor(projectPath: string): string {
  return createHash('sha256').update(projectPath).digest('hex').slice(0, 24);
}

export class ProjectResolver {
  private readonly cache = new Map<string, ResolvedProject>();

  resolve(workingDirectory: string | null | undefined): ResolvedProject | null {
    if (!workingDirectory) return null;
    const cached = this.cache.get(workingDirectory);
    if (cached) return cached;

    const root = resolveProjectRoot(workingDirectory);
    const gitRemote = readGitRemote(join(root, '.git'));
    const resolved: ResolvedProject = {
      id: projectIdFor(root),
      path: root,
      name: basename(root) || root,
      repository: repositoryNameFrom(gitRemote),
      gitRemote,
    };
    this.cache.set(workingDirectory, resolved);
    return resolved;
  }

  drain(): ResolvedProject[] {
    const unique = new Map<string, ResolvedProject>();
    for (const project of this.cache.values()) unique.set(project.id, project);
    return [...unique.values()];
  }

  clear(): void {
    this.cache.clear();
  }
}
