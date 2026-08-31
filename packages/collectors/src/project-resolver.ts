import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, parse } from 'node:path';
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
 * A path this machine cannot walk: a Windows path seen from POSIX, or anything relative.
 * `dirname()` reduces those to "." in one step and the walk would then test the server's own
 * directory for `.git`, pooling every such path into one project named ".".
 */
function isWalkable(workingDirectory: string): boolean {
  return isAbsolute(workingDirectory) && !/^[A-Za-z]:[\\/]/.test(workingDirectory);
}

/** The last segment of a path written in either separator, so a Windows path still names itself. */
export function projectNameFrom(projectPath: string): string {
  const segments = projectPath
    .split(/[\\/]+/)
    .filter((part) => part && part !== '.' && part !== '..');
  const last = segments[segments.length - 1];
  // Strip a trailing drive colon so "C:" never becomes a project name of its own.
  return last?.replace(/:$/, '') || projectPath;
}

/**
 * §6.1: projects are inferred from the working directory by walking up to the nearest
 * repository root, so the user never tags anything by hand (brief §26).
 */
export function resolveProjectRoot(workingDirectory: string): string {
  if (!isWalkable(workingDirectory)) return workingDirectory;

  let current = workingDirectory;
  const { root } = parse(workingDirectory);
  for (let depth = 0; depth < 40; depth++) {
    if (existsSync(join(current, '.git'))) return current;
    if (current === root) break;
    const parent = dirname(current);
    // "." is where a relative path bottoms out, and it means the server's own directory.
    if (parent === current || parent === '.') break;
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
    const gitRemote = isWalkable(root) ? readGitRemote(join(root, '.git')) : null;
    const resolved: ResolvedProject = {
      id: projectIdFor(root),
      path: root,
      name: projectNameFrom(root) || basename(root) || root,
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
