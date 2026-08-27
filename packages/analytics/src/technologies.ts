import type { TaskContext } from '@ai-footprint/shared';
import { normalizeForFingerprint } from './text';

export interface TechnologyMatch {
  technology: string;
  confidence: number;
}

export interface ContextMatch {
  context: TaskContext;
  confidence: number;
}

interface TechnologyEntry {
  name: string;
  aliases: string[];
  contexts: TaskContext[];
  extensions?: string[];
}

/** Aliases are matched on word boundaries so "go" never matches "going" (§6.3). */
const TECHNOLOGIES: TechnologyEntry[] = [
  {
    name: 'TypeScript',
    aliases: ['typescript', 'ts', 'tsx', 'tsc'],
    contexts: ['Backend', 'Frontend'],
    extensions: ['ts', 'tsx'],
  },
  {
    name: 'JavaScript',
    aliases: ['javascript', 'js', 'esm', 'node js'],
    contexts: ['Backend', 'Frontend'],
    extensions: ['js', 'mjs', 'cjs'],
  },
  {
    name: 'React',
    aliases: ['react', 'jsx', 'usestate', 'useeffect', 'react query'],
    contexts: ['Frontend'],
    extensions: ['jsx'],
  },
  { name: 'Next.js', aliases: ['next js', 'nextjs', 'app router'], contexts: ['Frontend'] },
  { name: 'Vue', aliases: ['vue', 'vuejs', 'nuxt'], contexts: ['Frontend'] },
  { name: 'Svelte', aliases: ['svelte', 'sveltekit'], contexts: ['Frontend'] },
  { name: 'Angular', aliases: ['angular', 'ngmodule'], contexts: ['Frontend'] },
  { name: 'Tailwind CSS', aliases: ['tailwind', 'tailwindcss'], contexts: ['Frontend'] },
  {
    name: 'CSS',
    aliases: ['css', 'flexbox', 'grid layout', 'scss', 'sass'],
    contexts: ['Frontend'],
    extensions: ['css', 'scss'],
  },
  { name: 'HTML', aliases: ['html', 'markup'], contexts: ['Frontend'], extensions: ['html'] },
  { name: 'NestJS', aliases: ['nestjs', 'nest js', 'nest'], contexts: ['Backend'] },
  { name: 'Express', aliases: ['express', 'expressjs'], contexts: ['Backend'] },
  { name: 'Fastify', aliases: ['fastify'], contexts: ['Backend'] },
  { name: 'Node.js', aliases: ['node', 'nodejs', 'npm', 'pnpm', 'yarn'], contexts: ['Backend'] },
  { name: 'Deno', aliases: ['deno'], contexts: ['Backend'] },
  { name: 'Bun', aliases: ['bun'], contexts: ['Backend'] },
  {
    name: 'Python',
    aliases: ['python', 'py', 'pip', 'poetry', 'venv'],
    contexts: ['Backend'],
    extensions: ['py'],
  },
  { name: 'Django', aliases: ['django'], contexts: ['Backend'] },
  { name: 'FastAPI', aliases: ['fastapi'], contexts: ['Backend'] },
  { name: 'Flask', aliases: ['flask'], contexts: ['Backend'] },
  {
    name: 'Go',
    aliases: ['golang', 'go mod', 'goroutine'],
    contexts: ['Backend'],
    extensions: ['go'],
  },
  {
    name: 'Rust',
    aliases: ['rust', 'cargo', 'tokio', 'serde'],
    contexts: ['Backend'],
    extensions: ['rs'],
  },
  {
    name: 'Java',
    aliases: ['java', 'spring boot', 'maven', 'gradle'],
    contexts: ['Backend'],
    extensions: ['java'],
  },
  { name: 'Kotlin', aliases: ['kotlin'], contexts: ['Backend'], extensions: ['kt'] },
  {
    name: 'C#',
    aliases: ['c sharp', 'csharp', 'dotnet', 'asp net'],
    contexts: ['Backend'],
    extensions: ['cs'],
  },
  {
    name: 'C++',
    aliases: ['c plus plus', 'cpp'],
    contexts: ['Backend'],
    extensions: ['cpp', 'hpp'],
  },
  { name: 'C', aliases: ['ansi c'], contexts: ['Backend'], extensions: ['c', 'h'] },
  {
    name: 'PHP',
    aliases: ['php', 'laravel', 'composer'],
    contexts: ['Backend'],
    extensions: ['php'],
  },
  {
    name: 'Ruby',
    aliases: ['ruby', 'rails', 'gemfile'],
    contexts: ['Backend'],
    extensions: ['rb'],
  },
  {
    name: 'Swift',
    aliases: ['swift', 'swiftui', 'xcode'],
    contexts: ['Frontend'],
    extensions: ['swift'],
  },
  {
    name: 'Flutter',
    aliases: ['flutter', 'dart', 'pubspec'],
    contexts: ['Frontend'],
    extensions: ['dart'],
  },
  {
    name: 'Solidity',
    aliases: ['solidity', 'smart contract', 'erc20', 'erc721'],
    contexts: ['Smart Contract'],
    extensions: ['sol'],
  },
  { name: 'Hardhat', aliases: ['hardhat'], contexts: ['Smart Contract'] },
  { name: 'Foundry', aliases: ['foundry', 'forge test'], contexts: ['Smart Contract'] },
  {
    name: 'Ethereum',
    aliases: ['ethereum', 'evm', 'web3', 'ethers', 'wagmi', 'viem'],
    contexts: ['Smart Contract'],
  },
  {
    name: 'Blockchain',
    aliases: ['blockchain', 'on chain', 'defi', 'nft'],
    contexts: ['Smart Contract'],
  },
  { name: 'PostgreSQL', aliases: ['postgres', 'postgresql', 'psql', 'pg'], contexts: ['Backend'] },
  { name: 'MySQL', aliases: ['mysql', 'mariadb'], contexts: ['Backend'] },
  { name: 'SQLite', aliases: ['sqlite', 'better sqlite'], contexts: ['Backend'] },
  { name: 'MongoDB', aliases: ['mongodb', 'mongo', 'mongoose'], contexts: ['Backend'] },
  { name: 'Redis', aliases: ['redis', 'ioredis'], contexts: ['Backend'] },
  { name: 'Drizzle', aliases: ['drizzle'], contexts: ['Backend'] },
  { name: 'Prisma', aliases: ['prisma'], contexts: ['Backend'] },
  { name: 'GraphQL', aliases: ['graphql', 'apollo'], contexts: ['Backend'] },
  { name: 'gRPC', aliases: ['grpc', 'protobuf'], contexts: ['Backend'] },
  {
    name: 'Docker',
    aliases: ['docker', 'dockerfile', 'container', 'swarm'],
    contexts: ['Infrastructure'],
  },
  {
    name: 'Kubernetes',
    aliases: ['kubernetes', 'k8s', 'kubectl', 'helm'],
    contexts: ['Infrastructure'],
  },
  { name: 'Terraform', aliases: ['terraform', 'hcl'], contexts: ['Infrastructure'] },
  {
    name: 'AWS',
    aliases: ['aws', 's3', 'lambda', 'ec2', 'dynamodb', 'cloudfront'],
    contexts: ['Infrastructure'],
  },
  {
    name: 'GCP',
    aliases: ['gcp', 'google cloud', 'bigquery', 'cloud run'],
    contexts: ['Infrastructure'],
  },
  { name: 'Azure', aliases: ['azure'], contexts: ['Infrastructure'] },
  { name: 'Nginx', aliases: ['nginx'], contexts: ['Infrastructure'] },
  {
    name: 'GitHub Actions',
    aliases: ['github actions', 'workflow yml'],
    contexts: ['Infrastructure'],
  },
  {
    name: 'Git',
    aliases: ['git', 'rebase', 'merge conflict', 'commit'],
    contexts: ['Infrastructure'],
  },
  {
    name: 'Linux',
    aliases: ['linux', 'ubuntu', 'debian', 'bash', 'systemd'],
    contexts: ['Infrastructure'],
  },
  { name: 'Vitest', aliases: ['vitest'], contexts: ['Testing'] },
  { name: 'Jest', aliases: ['jest'], contexts: ['Testing'] },
  { name: 'Playwright', aliases: ['playwright'], contexts: ['Testing'] },
  { name: 'Cypress', aliases: ['cypress'], contexts: ['Testing'] },
  { name: 'Pytest', aliases: ['pytest'], contexts: ['Testing'] },
  { name: 'Vite', aliases: ['vite'], contexts: ['Frontend'] },
  { name: 'Webpack', aliases: ['webpack'], contexts: ['Frontend'] },
  { name: 'ESLint', aliases: ['eslint', 'linting'], contexts: ['Frontend', 'Backend'] },
  { name: 'Kafka', aliases: ['kafka'], contexts: ['Infrastructure'] },
  { name: 'RabbitMQ', aliases: ['rabbitmq', 'amqp'], contexts: ['Infrastructure'] },
  { name: 'Elasticsearch', aliases: ['elasticsearch', 'opensearch'], contexts: ['Infrastructure'] },
  {
    name: 'Machine Learning',
    aliases: ['machine learning', 'pytorch', 'tensorflow', 'scikit', 'embedding', 'llm'],
    contexts: ['Research'],
  },
  {
    name: 'SQL',
    aliases: ['sql', 'query plan', 'join', 'index scan'],
    contexts: ['Backend'],
    extensions: ['sql'],
  },
  {
    name: 'Markdown',
    aliases: ['markdown', 'mdx'],
    contexts: ['Documentation'],
    extensions: ['md', 'mdx'],
  },
  {
    name: 'YAML',
    aliases: ['yaml', 'yml'],
    contexts: ['Infrastructure'],
    extensions: ['yml', 'yaml'],
  },
];

const BY_EXTENSION = new Map<string, TechnologyEntry>();
for (const entry of TECHNOLOGIES) {
  for (const extension of entry.extensions ?? []) BY_EXTENSION.set(extension, entry);
}

const CONTEXT_TERMS: Array<[TaskContext, string[]]> = [
  [
    'Backend',
    ['api', 'endpoint', 'server', 'database', 'migration', 'query', 'service layer', 'controller'],
  ],
  [
    'Frontend',
    ['ui', 'component', 'page', 'styling', 'layout', 'responsive', 'accessibility', 'browser'],
  ],
  ['Smart Contract', ['contract', 'on chain', 'gas', 'wallet', 'token', 'audit']],
  [
    'Infrastructure',
    ['deploy', 'pipeline', 'infrastructure', 'server config', 'scaling', 'monitoring'],
  ],
  ['Testing', ['test', 'coverage', 'assertion', 'mock', 'fixture']],
  ['Architecture', ['architecture', 'design', 'structure', 'pattern', 'boundary', 'trade off']],
  ['Documentation', ['docs', 'documentation', 'readme', 'guide', 'changelog']],
  ['Research', ['research', 'compare', 'evaluate', 'investigate', 'benchmark', 'options']],
];

export interface DetectionInput {
  text: string;
  fileExtensions?: string[];
  projectTechnologies?: string[];
}

export function detectTechnologies(input: DetectionInput): TechnologyMatch[] {
  const normalized = ` ${normalizeForFingerprint(input.text)} `;
  const found = new Map<string, number>();

  for (const entry of TECHNOLOGIES) {
    for (const alias of entry.aliases) {
      if (normalized.includes(` ${alias} `)) {
        found.set(entry.name, Math.max(found.get(entry.name) ?? 0, 0.85));
        break;
      }
    }
  }

  for (const extension of input.fileExtensions ?? []) {
    const entry = BY_EXTENSION.get(extension.toLowerCase());
    if (entry) found.set(entry.name, Math.max(found.get(entry.name) ?? 0, 0.7));
  }

  for (const technology of input.projectTechnologies ?? []) {
    if (!found.has(technology)) found.set(technology, 0.4);
  }

  return [...found.entries()]
    .map(([technology, confidence]) => ({ technology, confidence }))
    .sort((a, b) => b.confidence - a.confidence || a.technology.localeCompare(b.technology))
    .slice(0, 8);
}

export function detectContexts(
  input: DetectionInput,
  technologies: TechnologyMatch[],
): ContextMatch[] {
  const normalized = ` ${normalizeForFingerprint(input.text)} `;
  const scores = new Map<TaskContext, number>();

  for (const [context, terms] of CONTEXT_TERMS) {
    for (const term of terms) {
      if (normalized.includes(` ${term} `)) {
        scores.set(context, (scores.get(context) ?? 0) + 1);
      }
    }
  }

  const byName = new Map(TECHNOLOGIES.map((entry) => [entry.name, entry]));
  for (const match of technologies) {
    for (const context of byName.get(match.technology)?.contexts ?? []) {
      scores.set(context, (scores.get(context) ?? 0) + match.confidence);
    }
  }

  const total = [...scores.values()].reduce((sum, value) => sum + value, 0);
  if (total === 0) return [];

  return [...scores.entries()]
    .map(([context, value]) => ({ context, confidence: Math.round((value / total) * 100) / 100 }))
    .filter((entry) => entry.confidence >= 0.15)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 4);
}

const MANIFEST_SIGNALS: Array<[RegExp, string]> = [
  [/"next"\s*:/, 'Next.js'],
  [/"react"\s*:/, 'React'],
  [/"vue"\s*:/, 'Vue'],
  [/"svelte"\s*:/, 'Svelte'],
  [/"@angular\/core"\s*:/, 'Angular'],
  [/"@nestjs\/core"\s*:/, 'NestJS'],
  [/"express"\s*:/, 'Express'],
  [/"fastify"\s*:/, 'Fastify'],
  [/"tailwindcss"\s*:/, 'Tailwind CSS'],
  [/"drizzle-orm"\s*:/, 'Drizzle'],
  [/"prisma"\s*:/, 'Prisma'],
  [/"vitest"\s*:/, 'Vitest'],
  [/"jest"\s*:/, 'Jest'],
  [/"@playwright\/test"\s*:/, 'Playwright'],
  [/"typescript"\s*:/, 'TypeScript'],
  [/^django/im, 'Django'],
  [/^fastapi/im, 'FastAPI'],
  [/^flask/im, 'Flask'],
  [/^pytest/im, 'Pytest'],
  [/\[dependencies\]/, 'Rust'],
  [/^module\s+\S+/m, 'Go'],
  [/hardhat/i, 'Hardhat'],
  [/foundry/i, 'Foundry'],
];

/** Opt-in per §6.3, and read-only: manifests are a hint, never a data source. */
export function technologiesFromManifest(content: string): string[] {
  const found = new Set<string>();
  for (const [pattern, technology] of MANIFEST_SIGNALS) {
    if (pattern.test(content)) found.add(technology);
  }
  return [...found];
}
