#!/usr/bin/env node
import { accent, dim, fail, line } from './lib/console.mjs';
import { findFreePort, npmCommand, repoRoot, run, spawnStreaming } from './lib/env.mjs';

const root = repoRoot();

/**
 * One terminal in development too: the API runs with reload, and Vite proxies /api to it,
 * so the same relative URLs work in dev and in the built single-origin app.
 */
async function main() {
  const build = run(npmCommand(), ['run', 'build:packages'], { cwd: root });
  if (!build.ok) fail('The shared packages failed to build.', ['Run "npm run build:packages".']);

  const apiPort = await findFreePort(4173);
  const webPort = await findFreePort(5173);
  if (!apiPort || !webPort) fail('No free ports were available for the dev servers.');

  const children = [
    spawnStreaming(npmCommand(), ['run', 'dev', '--workspace', '@ai-footprint/api'], {
      cwd: root,
      env: { ...process.env, AI_FOOTPRINT_PORT: String(apiPort) },
    }),
    spawnStreaming(
      npmCommand(),
      ['run', 'dev', '--workspace', '@ai-footprint/web', '--', '--port', String(webPort)],
      {
        cwd: root,
        env: { ...process.env, AI_FOOTPRINT_API_URL: `http://127.0.0.1:${apiPort}` },
      },
    ),
  ];

  line();
  line(`  ${dim('Web')}  ${accent(`http://localhost:${webPort}`)}  ${dim('(hot reload)')}`);
  line(`  ${dim('API')}  http://localhost:${apiPort}`);
  line();

  const stop = () => {
    for (const child of children) child.kill('SIGTERM');
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  for (const child of children) {
    child.on('exit', (code) => {
      stop();
      process.exit(code ?? 0);
    });
  }
}

main();
