#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.turbo',
  'playwright-report',
  'test-results',
  '.vitest',
  'tmp',
]);

const SKIP_FILES = new Set(['package-lock.json', 'hygiene.mjs', 'promt.txt']);

const TEXT_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.yml',
  '.yaml',
  '.sh',
  '.ps1',
  '.html',
  '.css',
  '.sql',
  '.txt',
  '.toml',
  '',
]);

const SECRET_PATTERNS = [
  { name: 'aws_access_key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'openai_key', re: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { name: 'anthropic_key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'github_token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: 'private_key', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
];

/**
 * A test that proves secrets are redacted has to contain secret-shaped strings. The marker
 * must be written into the file deliberately, so the exemption is visible in review rather
 * than inferred from a path.
 */
const SECRET_FIXTURE_MARKER = 'hygiene:allow-secret-fixtures';

const BANNED_FILES = [
  {
    match: (p) => /(^|\/)docker-compose(\.\w+)?\.ya?ml$/.test(p),
    why: 'Docker Compose is forbidden (brief §7/§47); use docker/stack.yml',
  },
  {
    match: (p) => /\.(db|sqlite3?|db-wal|db-shm)$/.test(p),
    why: 'database files must never be committed',
  },
  { match: (p) => /(^|\/)\.env$/.test(p), why: 'environment files must never be committed' },
];

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(join(dir, entry.name));
    } else if (entry.isFile()) {
      yield join(dir, entry.name);
    }
  }
}

const failures = [];

for (const absolute of walk(ROOT)) {
  const rel = relative(ROOT, absolute).split(sep).join('/');
  const base = rel.split('/').pop();

  for (const banned of BANNED_FILES) {
    if (banned.match(rel)) failures.push(`${rel}: ${banned.why}`);
  }

  if (SKIP_FILES.has(base)) continue;
  if (!TEXT_EXT.has(extname(absolute))) continue;
  if (statSync(absolute).size > 2_000_000) continue;

  let content;
  try {
    content = readFileSync(absolute, 'utf8');
  } catch {
    continue;
  }

  const allowsFixtures = content.includes(SECRET_FIXTURE_MARKER);
  const lines = content.split('\n');
  lines.forEach((line, index) => {
    if (allowsFixtures) return;
    for (const { name, re } of SECRET_PATTERNS) {
      if (re.test(line)) failures.push(`${rel}:${index + 1}: possible committed secret (${name})`);
    }
  });
}

if (failures.length > 0) {
  console.error('Repository hygiene check failed:\n');
  for (const failure of failures) console.error(`  ${failure}`);
  console.error(`\n${failures.length} problem(s) found.`);
  process.exit(1);
}

console.log('Repository hygiene check passed.');
