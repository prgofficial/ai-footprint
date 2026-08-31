#!/usr/bin/env node
import { join } from 'node:path';
import { fail, line } from './lib/console.mjs';
import {
  buildArtifactsExist,
  findFreePort,
  npmCommand,
  repoRoot,
  run,
  spawnStreaming,
} from './lib/env.mjs';

const root = repoRoot();

async function main() {
  if (!buildArtifactsExist(root)) {
    line('  Building AI Footprint for the first time…');
    const build = run(npmCommand(), ['run', 'build'], { cwd: root });
    if (!build.ok) fail('The build failed.', ['Run "npm run build" to see the full output.']);
  }

  const port = await findFreePort(Number(process.env.AI_FOOTPRINT_PORT) || 4173);
  if (!port)
    fail('No free port was available.', ['Set AI_FOOTPRINT_PORT to a port you know is free.']);

  const child = spawnStreaming(process.execPath, [join(root, 'apps', 'api', 'dist', 'main.js')], {
    cwd: root,
    env: { ...process.env, AI_FOOTPRINT_PORT: String(port) },
  });

  const forward = (signal) => () => child.kill(signal);
  process.on('SIGINT', forward('SIGINT'));
  process.on('SIGTERM', forward('SIGTERM'));
  child.on('exit', (code) => process.exit(code ?? 0));
}

main();
