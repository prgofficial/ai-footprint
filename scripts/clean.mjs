#!/usr/bin/env node
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { line } from './lib/console.mjs';
import { repoRoot } from './lib/env.mjs';

const root = repoRoot();
const targets = [
  'apps/api/dist',
  'apps/web/dist',
  'packages/shared/dist',
  'packages/config/dist',
  'packages/database/dist',
  'packages/analytics/dist',
  'packages/collectors/dist',
  'coverage',
  'playwright-report',
  'test-results',
];

for (const target of targets) {
  rmSync(join(root, target), { recursive: true, force: true });
}
for (const target of ['shared', 'config', 'database', 'analytics', 'collectors']) {
  rmSync(join(root, 'packages', target, 'tsconfig.tsbuildinfo'), { force: true });
}
rmSync(join(root, 'apps', 'api', 'tsconfig.tsbuildinfo'), { force: true });

line('Build output removed. Your data in the AI Footprint directory was not touched.');
