import { join } from 'node:path';
import pino, { type Logger, type LoggerOptions } from 'pino';
import { getAppPaths } from './paths';

/**
 * Brief §35: prompts, responses, source code, keys and env vars must never reach a log.
 * An allowlist is the only version of this rule that survives a careless call site, so
 * every log object is projected onto these keys and everything else is dropped.
 */
const ALLOWED_KEYS = new Set([
  'accepted',
  'attempt',
  'batchId',
  'bytes',
  'bytesDone',
  'bytesTotal',
  'category',
  'code',
  'count',
  'deduped',
  'durationMs',
  'err',
  'error',
  'eventCount',
  'eventType',
  'failed',
  'file',
  'filesDone',
  'filesTotal',
  'from',
  'granularity',
  'hookEvent',
  'host',
  'id',
  'kind',
  'limit',
  'method',
  'mode',
  'model',
  'msg',
  'name',
  'offset',
  'operation',
  'parseErrors',
  'path',
  'phase',
  'pid',
  'platform',
  'port',
  'projectId',
  'providerId',
  'range',
  'reason',
  'redactions',
  'rows',
  'scope',
  'sessionId',
  'sizeBytes',
  'source',
  'state',
  'status',
  'statusCode',
  'table',
  'timezone',
  'to',
  'took',
  'total',
  'url',
  'version',
]);

const SENSITIVE_HINT = /(prompt|response|text|content|token|secret|key|password|credential|env)/i;

function projectValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 3) return '[truncated]';
  const type = typeof value;
  if (type === 'string') {
    const s = value as string;
    return s.length > 200 ? `${s.slice(0, 200)}…` : s;
  }
  if (type === 'number' || type === 'boolean' || type === 'bigint') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => projectValue(v, depth + 1));
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (type === 'object') return project(value as Record<string, unknown>, depth + 1);
  return '[unloggable]';
}

function project(input: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (SENSITIVE_HINT.test(key) && !ALLOWED_KEYS.has(key)) continue;
    if (depth === 0 && !ALLOWED_KEYS.has(key)) continue;
    out[key] = projectValue(value, depth);
  }
  return out;
}

export const redactionHooks: LoggerOptions['hooks'] = {
  logMethod(args, method) {
    const [first, ...rest] = args;
    if (first && typeof first === 'object' && !(first instanceof Error)) {
      method.apply(this, [project(first as Record<string, unknown>), ...rest] as never);
      return;
    }
    method.apply(this, args as never);
  },
};

export interface CreateLoggerOptions {
  level?: string;
  toFile?: boolean;
  name?: string;
  destinationDir?: string;
}

let rootLogger: Logger | null = null;

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const level = options.level ?? process.env.AI_FOOTPRINT_LOG_LEVEL ?? 'info';
  const base: LoggerOptions = {
    level,
    name: options.name ?? 'ai-footprint',
    base: { pid: process.pid },
    redact: {
      paths: ['prompt', 'response', 'text', 'apiKey', 'token', 'authorization', 'headers'],
      censor: '[redacted]',
    },
    hooks: redactionHooks,
    formatters: {
      level: (label) => ({ level: label }),
    },
  };

  if (options.toFile === false) return pino(base);

  const dir = options.destinationDir ?? getAppPaths().logs;
  try {
    const transport = pino.transport({
      targets: [
        {
          target: 'pino-roll',
          level,
          options: {
            file: join(dir, 'app.log'),
            frequency: 'daily',
            mkdir: true,
            limit: { count: 7 },
          },
        },
      ],
    });
    return pino(base, transport);
  } catch {
    return pino(base);
  }
}

export function getLogger(): Logger {
  if (!rootLogger) rootLogger = createLogger();
  return rootLogger;
}

export function setLogger(logger: Logger): void {
  rootLogger = logger;
}

export type { Logger };
