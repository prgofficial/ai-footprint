import { CLASSIFIER_VERSION, type PromptCategory } from '@ai-footprint/shared';
import { normalizeForFingerprint } from './text';

export interface ClassificationSignals {
  text: string;
  /** Tools Claude Code ran in the turn that followed. The single strongest signal. */
  toolNames?: string[];
}

export interface ClassificationOutcome {
  category: PromptCategory;
  confidence: number;
  version: number;
  scores: Partial<Record<PromptCategory, number>>;
}

/** Pluggable so a local model can be added later without the app ever depending on one. */
export interface Classifier {
  readonly version: number;
  classify(signals: ClassificationSignals): ClassificationOutcome;
}

interface Lexicon {
  category: PromptCategory;
  weight: number;
  terms: string[];
}

const LEXICONS: Lexicon[] = [
  {
    category: 'Debugging',
    weight: 3,
    terms: [
      'error',
      'errors',
      'bug',
      'bugs',
      'crash',
      'crashes',
      'crashing',
      'failing',
      'fails',
      'returns undefined',
      'instead of the',
      'is empty but',
      'but the query',
      'only in production',
      'failed',
      'exception',
      'traceback',
      'stacktrace',
      'stack trace',
      'broken',
      'not working',
      'doesn t work',
      'does not work',
      'why is',
      'why does',
      'why doesn',
      'debug',
      'fix',
      'fixing',
      'undefined is not',
      'null pointer',
      'segfault',
      'timeout',
      'hangs',
      'stuck',
      'regression',
      'reproduce',
      'root cause',
      'econnrefused',
      'panic',
      'nan',
      'infinite loop',
    ],
  },
  {
    category: 'Implementation',
    weight: 2,
    terms: [
      'implement',
      'add a',
      'add the',
      'build',
      'create',
      'write a',
      'write the',
      'make a',
      'generate',
      'scaffold',
      'wire up',
      'hook up',
      'integrate',
      'support for',
      'feature',
      'endpoint',
      'component',
      'function that',
      'method that',
      'class that',
      'set up',
      'new page',
      'new screen',
      'new module',
    ],
  },
  {
    category: 'Code Review',
    weight: 5,
    terms: [
      'review',
      'code review',
      'look over',
      'critique',
      'feedback on',
      'pull request',
      'pr ',
      'diff',
      'is this correct',
      'any issues',
      'anything wrong',
      'security review',
      'best practice',
      'code smell',
      'audit',
      'lgtm',
    ],
  },
  {
    category: 'Refactoring',
    weight: 5,
    terms: [
      'refactor',
      'clean up',
      'cleanup',
      'simplify',
      'rename',
      'extract',
      'deduplicate',
      'dry ',
      'restructure',
      'reorganize',
      'reorganise',
      'tidy',
      'modernize',
      'modernise',
      'migrate to',
      'split into',
      'split this',
      'smaller modules',
      'consolidate',
      'reduce duplication',
    ],
  },
  {
    category: 'Explanation',
    weight: 3,
    terms: [
      'explain',
      'what does',
      'what is',
      'how does',
      'walk me through',
      'help me understand',
      'meaning of',
      'difference between',
      'why would',
      'when should',
      'tell me about',
      'clarify',
      'summarize this code',
      'what happens when',
    ],
  },
  {
    category: 'Research',
    weight: 3,
    terms: [
      'research',
      'find out',
      'look up',
      'search for',
      'compare',
      'options for',
      'alternatives',
      'which library',
      'which framework',
      'pros and cons',
      'evaluate',
      'investigate',
      'is there a',
      'recommend',
      'best way to',
      'state of the art',
      'benchmark',
    ],
  },
  {
    category: 'Planning',
    weight: 5,
    terms: [
      'plan',
      'roadmap',
      'milestone',
      'break down',
      'break this into',
      'steps to',
      'approach for',
      'strategy',
      'todo',
      'backlog',
      'estimate',
      'sequence',
      'phases',
      'what should i do',
      'next steps',
      'prioritize',
      'prioritise',
    ],
  },
  {
    category: 'Documentation',
    weight: 5,
    terms: [
      'document',
      'documentation',
      'readme',
      'docstring',
      'jsdoc',
      'comment the',
      'add comments',
      'changelog',
      'api docs',
      'write docs',
      'usage guide',
      'tutorial for',
      'contributing guide',
    ],
  },
  {
    category: 'Testing',
    weight: 5,
    terms: [
      'test',
      'tests',
      'unit test',
      'integration test',
      'e2e',
      'end to end',
      'coverage',
      'vitest',
      'jest',
      'pytest',
      'playwright',
      'cypress',
      'mock',
      'stub',
      'fixture',
      'assertion',
      'test case',
      'snapshot test',
      'flaky',
    ],
  },
  {
    category: 'DevOps',
    weight: 5,
    terms: [
      'docker',
      'dockerfile',
      'kubernetes',
      'k8s',
      'helm',
      'terraform',
      'ansible',
      'ci ',
      'cicd',
      'ci cd',
      'pipeline',
      'github actions',
      'gitlab ci',
      'jenkins',
      'deploy',
      'deployment',
      'nginx',
      'systemd',
      'swarm',
      'container',
      'aws',
      'gcp',
      'azure',
      'cloudformation',
      'monitoring',
      'observability',
      'load balancer',
      'dns',
      'ssl',
      'certificate',
      'environment variable',
      'secrets manager',
      'rollout',
    ],
  },
  {
    category: 'Architecture',
    weight: 5,
    terms: [
      'architecture',
      'architect',
      'design pattern',
      'system design',
      'schema design',
      'data model',
      'should i use',
      'trade off',
      'tradeoff',
      'scalability',
      'microservice',
      'monolith',
      'event driven',
      'separation of concerns',
      'boundaries',
      'layering',
      'domain model',
      'high level design',
    ],
  },
  {
    category: 'Writing',
    weight: 5,
    terms: [
      'write a post',
      'blog',
      'email',
      'copy for',
      'marketing',
      'announcement',
      'release notes',
      'proposal',
      'rephrase',
      'reword',
      'tone',
      'draft a',
      'newsletter',
      'landing page copy',
      'commit message',
    ],
  },
];

/**
 * Ordered by specificity: an unambiguous verb is strong evidence, while "add"/"write"/
 * "create" open half of all prompts and are therefore worth almost nothing on their own.
 */
const VERB_HEADS: Array<[RegExp, PromptCategory, number]> = [
  [/^(?:fix|debug|troubleshoot|diagnose)\b/, 'Debugging', 6],
  [/^(?:refactor|simplify|rename|restructure|deduplicate)\b/, 'Refactoring', 6],
  [/^(?:deploy|dockerize|dockerise|containerize|containerise|provision)\b/, 'DevOps', 6],
  [/^(?:review|audit|critique)\b/, 'Code Review', 5],
  [/^(?:research|compare|evaluate|investigate|benchmark)\b/, 'Research', 5],
  [/^(?:plan|outline|prioriti[sz]e|estimate)\b/, 'Planning', 5],
  [/^(?:document|write docs|write documentation)\b/, 'Documentation', 5],
  [/^(?:why|whats wrong|what s wrong)\b/, 'Debugging', 4],
  [/^(?:explain|describe|clarify|walk me through|help me understand)\b/, 'Explanation', 4],
  [/^what (?:is|does|are the difference|happens|do)\b/, 'Explanation', 3],
  [/^how (?:does|do|can|should|would)\b/, 'Explanation', 3],
  [/^(?:draft|reword|rephrase)\b/, 'Writing', 5],
  [/^(?:implement|scaffold|integrate)\b/, 'Implementation', 4],
  [/^(?:add|build|create|make|write|generate|set up|wire)\b/, 'Implementation', 2],
];

const TOOL_SIGNALS: Array<
  [PromptCategory, (tools: Set<string>, counts: Map<string, number>) => number]
> = [
  [
    'Implementation',
    (tools) => (tools.has('Edit') || tools.has('Write') || tools.has('NotebookEdit') ? 3 : 0),
  ],
  ['Research', (tools) => (tools.has('WebSearch') || tools.has('WebFetch') ? 4 : 0)],
  [
    'Research',
    (tools, counts) =>
      (counts.get('Read') ?? 0) + (counts.get('Grep') ?? 0) > 0 &&
      !tools.has('Edit') &&
      !tools.has('Write')
        ? 3
        : 0,
  ],
  ['Planning', (tools) => (tools.has('TodoWrite') ? 2 : 0)],
  ['Testing', (_tools, counts) => ((counts.get('Bash') ?? 0) > 0 ? 0 : 0)],
];

function scoreLexicons(normalized: string, scores: Map<PromptCategory, number>): void {
  const padded = ` ${normalized} `;
  for (const lexicon of LEXICONS) {
    for (const term of lexicon.terms) {
      if (padded.includes(` ${term} `) || padded.includes(` ${term}`)) {
        scores.set(lexicon.category, (scores.get(lexicon.category) ?? 0) + lexicon.weight);
      }
    }
  }
}

function scoreVerbHead(normalized: string, scores: Map<PromptCategory, number>): void {
  for (const [pattern, category, weight] of VERB_HEADS) {
    if (pattern.test(normalized)) {
      scores.set(category, (scores.get(category) ?? 0) + weight);
      return;
    }
  }
}

function scoreTools(toolNames: string[], scores: Map<PromptCategory, number>): void {
  if (toolNames.length === 0) return;
  const counts = new Map<string, number>();
  for (const name of toolNames) counts.set(name, (counts.get(name) ?? 0) + 1);
  const tools = new Set(counts.keys());

  for (const [category, evaluate] of TOOL_SIGNALS) {
    const value = evaluate(tools, counts);
    if (value > 0) scores.set(category, (scores.get(category) ?? 0) + value);
  }
}

/**
 * §6.2: deterministic, offline and versioned. It returns a confidence, and below the
 * threshold the answer is `Other`; the UI then says "unclassified" instead of asserting
 * a category it cannot support (brief §21).
 */
export class HeuristicClassifier implements Classifier {
  readonly version = CLASSIFIER_VERSION;
  private readonly threshold: number;

  constructor(threshold = 0.3) {
    this.threshold = threshold;
  }

  classify(signals: ClassificationSignals): ClassificationOutcome {
    const normalized = normalizeForFingerprint(signals.text);
    const scores = new Map<PromptCategory, number>();

    scoreLexicons(normalized, scores);
    scoreVerbHead(normalized, scores);
    scoreTools(signals.toolNames ?? [], scores);

    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    const best = ranked[0];
    const runnerUp = ranked[1];

    if (!best || best[1] <= 0) {
      return { category: 'Other', confidence: 0, version: this.version, scores: {} };
    }

    const total = ranked.reduce((sum, [, value]) => sum + value, 0);
    const dominance = best[1] / total;
    const margin = runnerUp ? (best[1] - runnerUp[1]) / best[1] : 1;
    const evidence = Math.min(1, best[1] / 10);
    const confidence =
      Math.round(Math.min(1, dominance * 0.5 + margin * 0.25 + evidence * 0.25) * 100) / 100;

    const scoreRecord: Partial<Record<PromptCategory, number>> = {};
    for (const [category, value] of ranked.slice(0, 4)) scoreRecord[category] = value;

    if (confidence < this.threshold) {
      return { category: 'Other', confidence, version: this.version, scores: scoreRecord };
    }
    return { category: best[0], confidence, version: this.version, scores: scoreRecord };
  }
}
