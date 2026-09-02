#!/usr/bin/env node
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { dim, fail, line, ok } from './lib/console.mjs';
import {
  findFreePort,
  hostUserIds,
  repoRoot,
  run,
  swarmActive,
  waitForHealth,
} from './lib/env.mjs';

const STACK = process.env.AI_FOOTPRINT_STACK ?? 'ai-footprint-smoke';
const root = repoRoot();

/**
 * Brief §8 and §47: removing and redeploying the stack must not lose data. This proves it
 * rather than asserting it, by ingesting events, tearing the stack down and comparing counts.
 */
async function main() {
  if (!swarmActive()) {
    const init = run('docker', ['swarm', 'init'], { quiet: true });
    if (!init.ok && !swarmActive()) fail('Docker Swarm could not be initialised.');
  }

  // Docker Desktop and colima only expose a subset of the host filesystem to their VM,
  // and the system temp directory is usually outside it. The home directory always works,
  // which is also where the real data directory lives.
  const scratchRoot = join(homedir(), '.ai-footprint-stack-tests');
  mkdirSync(scratchRoot, { recursive: true });
  const dataDirectory = mkdtempSync(join(scratchRoot, 'run-'));
  const port = await findFreePort(4600);
  if (!port) fail('No free port for the smoke test.');

  const env = {
    ...process.env,
    AI_FOOTPRINT_PORT: String(port),
    AI_FOOTPRINT_DATA: dataDirectory,
    ...hostUserIds(),
  };
  const stackFile = join(root, 'docker', 'stack.yml');

  const deploy = () => {
    const result = run('docker', ['stack', 'deploy', '--detach=true', '-c', stackFile, STACK], {
      env,
      quiet: true,
    });
    if (!result.ok) fail('Stack deploy failed.', [result.stderr || result.stdout]);
  };
  const remove = () => run('docker', ['stack', 'rm', STACK], { quiet: true });

  const waitGone = async () => {
    for (let attempt = 0; attempt < 60; attempt++) {
      const result = run('docker', ['stack', 'ps', STACK], { quiet: true });
      if (!result.ok) return;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  };

  const url = `http://127.0.0.1:${port}`;

  try {
    line(`  Deploying ${STACK} on port ${port}…`);
    deploy();

    const health = await waitForHealth(`${url}/api/health`, { timeoutMs: 240_000 });
    if (!health) {
      // A task that dies before it opens a log leaves `service logs` empty, which is how this
      // last failed: four silent minutes and no reason. The task list carries the reason in
      // its error column, so print that first and the log second.
      line(`  ${dim('docker service ps:')}`);
      run('docker', ['service', 'ps', '--no-trunc', `${STACK}_app`]);
      line(`  ${dim('docker service logs:')}`);
      run('docker', ['service', 'logs', '--tail', '80', `${STACK}_app`]);
      fail('The stack never became healthy.');
    }
    ok(`Healthy — version ${health.version}`);

    const runtime = JSON.parse(
      run(
        'docker',
        [
          'run',
          '--rm',
          '-v',
          `${dataDirectory}:/data:ro`,
          'busybox',
          'cat',
          '/data/config/runtime.json',
        ],
        {
          quiet: true,
        },
      ).stdout || '{}',
    );
    if (!runtime.ingestToken) fail('The container did not write a runtime configuration.');

    const events = Array.from({ length: 25 }, (_, index) => ({
      externalId: `smoke-${index}`,
      eventType: 'prompt',
      timestamp: new Date(Date.now() - index * 60_000).toISOString(),
      sessionId: 'smoke-session',
      prompt: `smoke test prompt ${index}`,
      workingDirectory: '/tmp/smoke',
    }));

    const ingest = await fetch(`${url}/api/ingest/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ai-footprint-token': runtime.ingestToken },
      body: JSON.stringify({ providerId: 'claude-code', events }),
    });
    if (!ingest.ok) fail(`Ingestion failed with status ${ingest.status}.`);
    const accepted = (await ingest.json()).accepted;
    ok(`${accepted} events ingested`);

    const before = await (await fetch(`${url}/api/analytics/overview?range=all`)).json();
    line(`  ${dim(`${before.totals.events} events before teardown`)}`);

    line('  Removing the stack…');
    remove();
    await waitGone();
    ok('Stack removed');

    line('  Redeploying…');
    deploy();
    const healthAgain = await waitForHealth(`${url}/api/health`, { timeoutMs: 240_000 });
    if (!healthAgain) fail('The stack did not come back.');

    const after = await (await fetch(`${url}/api/analytics/overview?range=all`)).json();
    if (after.totals.events !== before.totals.events) {
      fail(
        `Data was lost across a redeploy: ${before.totals.events} events before, ${after.totals.events} after.`,
      );
    }
    ok(`${after.totals.events} events survived stack rm + redeploy`);
    line();
    line('  Persistence verified.');
    line();
  } finally {
    remove();
    await waitGone();
    rmSync(dataDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => fail('The stack smoke test failed.', [String(error)]));
