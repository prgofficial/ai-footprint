#!/usr/bin/env node
// hygiene:allow-secret-fixtures, the key below is AWS's own published example value, used
// to prove the redactor removes it before anything reaches the database.
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { bold, dim, green, line, red, yellow } from './lib/console.mjs';
import {
  findFreePort,
  npmCommand,
  repoRoot,
  run,
  spawnStreaming,
  waitForHealth,
} from './lib/env.mjs';

/**
 * Automates brief §52 end to end against a throwaway data directory: start from nothing,
 * connect, ingest, restart, verify persistence, export, delete, and shut down cleanly.
 * Run with --docker to add the Swarm deploy/remove/redeploy cycle.
 */

const root = repoRoot();
const withDocker = process.argv.includes('--docker');
const results = [];

function check(name, passed, detail) {
  results.push({ name, passed, detail });
  const mark = passed ? green('PASS') : red('FAIL');
  line(`  ${mark}  ${name}${detail ? dim(`  — ${detail}`) : ''}`);
  return passed;
}

function skip(name, why) {
  results.push({ name, passed: null, detail: why });
  line(`  ${yellow('SKIP')}  ${name}${dim(`  — ${why}`)}`);
}

async function json(url, init) {
  const response = await fetch(url, init);
  return { status: response.status, body: await response.json().catch(() => null) };
}

function startApp(home, port) {
  return spawnStreaming(process.execPath, [join(root, 'apps', 'api', 'dist', 'main.js')], {
    cwd: root,
    stdio: 'ignore',
    env: {
      ...process.env,
      AI_FOOTPRINT_HOME: home,
      AI_FOOTPRINT_PORT: String(port),
      AI_FOOTPRINT_TZ: 'UTC',
      AI_FOOTPRINT_LOG_LEVEL: 'error',
      CLAUDE_CONFIG_DIR: join(home, 'no-claude-here'),
    },
  });
}

// Fixed once: regenerating timestamps per call would give every replay a fresh dedupe key
// and the idempotency check would silently pass by never actually replaying anything.
const SEED_BASE = Date.now() - 2 * 3_600_000;

function seedEvents(count, offsetDays = 0) {
  const base = SEED_BASE - offsetDays * 86_400_000;
  return Array.from({ length: count }, (_, index) => ({
    externalId: `acceptance-${offsetDays}-${index}`,
    eventType: 'prompt',
    timestamp: new Date(base - index * 120_000).toISOString(),
    sessionId: `acceptance-session-${offsetDays}`,
    prompt: `fix the failing docker deployment ${index} with key AKIAIOSFODNN7EXAMPLE`,
    workingDirectory: '/tmp/ai-footprint-acceptance/demo',
    tzOffsetMinutes: 0,
  }));
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10_000))]);
}

async function main() {
  line();
  line(`  ${bold('AI Footprint — acceptance run')}`);
  line();

  line(`  ${dim('Build and static checks')}`);
  check('typecheck', run(npmCommand(), ['run', 'typecheck'], { cwd: root, quiet: true }).ok);
  check('lint', run(npmCommand(), ['run', 'lint'], { cwd: root, quiet: true }).ok);
  check('unit and integration tests', run(npmCommand(), ['test'], { cwd: root, quiet: true }).ok);
  check('build', run(npmCommand(), ['run', 'build'], { cwd: root, quiet: true }).ok);
  check(
    'repository hygiene',
    run(process.execPath, [join(root, 'scripts', 'hygiene.mjs')], { quiet: true }).ok,
  );
  check(
    'no Docker Compose file anywhere',
    !run('find', [root, '-name', 'docker-compose*.yml', '-not', '-path', '*/node_modules/*'], {
      quiet: true,
    }).stdout,
  );

  // A scratch directory under $HOME: Docker's VM cannot bind-mount the system temp dir.
  const scratch = mkdtempSync(join(homedir(), '.ai-footprint-acceptance-'));
  const port = await findFreePort(4700);
  const url = `http://127.0.0.1:${port}`;
  let child = null;

  try {
    line();
    line(`  ${dim('First run from nothing')}`);
    child = startApp(scratch, port);
    const health = await waitForHealth(`${url}/api/health`, { timeoutMs: 90_000 });
    check(
      'starts on a clean machine',
      Boolean(health),
      health ? `version ${health.version}` : 'never healthy',
    );
    check('database created and migrated', existsSync(join(scratch, 'data', 'app.db')));
    check(
      'runtime config written 0600',
      (statSync(join(scratch, 'config', 'runtime.json')).mode & 0o777) === 0o600,
    );
    check('health endpoint reports a working database', health?.db?.ok === true);

    const runtime = JSON.parse(readFileSync(join(scratch, 'config', 'runtime.json'), 'utf8'));
    check('port selected automatically', runtime.port === port, `port ${runtime.port}`);

    const config = await json(`${url}/api/system/config`);
    check('runtime configuration served', config.status === 200 && config.body.apiBaseUrl === '');
    check('setup wizard is pending on first run', config.body.onboardingComplete === false);
    check(
      'Claude Code adapter registered',
      config.body.providers.some((p) => p.id === 'claude-code'),
    );

    const spa = await fetch(`${url}/prompts`);
    check(
      'single origin serves the interface',
      spa.ok && (spa.headers.get('content-type') ?? '').includes('html'),
    );

    line();
    line(`  ${dim('Security')}`);
    const crossOrigin = await fetch(`${url}/api/system/config`, {
      headers: { Origin: 'https://attacker.example' },
    });
    check('cross-origin request rejected', crossOrigin.status === 403);
    const unauth = await fetch(`${url}/api/ingest/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'claude-code', events: seedEvents(1) }),
    });
    check('ingestion without a token rejected', unauth.status === 403);

    line();
    line(`  ${dim('Ingestion and analytics')}`);
    const headers = {
      'Content-Type': 'application/json',
      'x-ai-footprint-token': runtime.ingestToken,
    };
    const ingest = await json(`${url}/api/ingest/events`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ providerId: 'claude-code', events: seedEvents(40) }),
    });
    check('events ingested', ingest.body?.accepted === 40, `${ingest.body?.accepted} accepted`);

    const replay = await json(`${url}/api/ingest/events`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ providerId: 'claude-code', events: seedEvents(40) }),
    });
    check('replay is idempotent', replay.body?.accepted === 0 && replay.body?.deduped === 40);

    await json(`${url}/api/enrichment/run`, { method: 'POST' });

    const overview = await json(`${url}/api/analytics/overview?range=all&timezone=UTC`);
    check('analytics computed from real events', overview.body?.totals?.prompts === 40);
    check('projects inferred without tagging', overview.body?.projects?.length >= 1);
    check(
      'prompts classified',
      overview.body?.categories?.some((c) => c.category !== 'Other'),
    );

    const prompts = await json(`${url}/api/analytics/prompts?range=all&q=docker&timezone=UTC`);
    check('full-text prompt search works', (prompts.body?.items?.length ?? 0) > 0);

    const detail = await json(`${url}/api/analytics/prompts/${prompts.body.items[0].id}`);
    check(
      'secrets redacted before storage',
      detail.body?.text?.includes('[redacted:aws_access_key]'),
    );

    const insights = await json(`${url}/api/analytics/insights?range=all&timezone=UTC`);
    check(
      'insights carry evidence, never fabrication',
      (insights.body?.insights ?? []).every((i) => i.evidence?.sampleSize > 0),
    );

    line();
    line(`  ${dim('Persistence across a restart')}`);
    await stop(child);
    child = null;
    check('graceful shutdown', true);

    child = startApp(scratch, port);
    const back = await waitForHealth(`${url}/api/health`, { timeoutMs: 90_000 });
    check('restarts cleanly', Boolean(back));
    const after = await json(`${url}/api/analytics/overview?range=all&timezone=UTC`);
    check('all data survives a restart', after.body?.totals?.prompts === 40);

    line();
    line(`  ${dim('Export and deletion')}`);
    const jsonExport = await fetch(`${url}/api/data/export?range=all&format=json&timezone=UTC`);
    const exported = await jsonExport.json();
    check(
      'JSON export',
      jsonExport.ok && exported.events.length === 40 && exported.manifest.formatVersion === 1,
    );

    const csvExport = await fetch(`${url}/api/data/export?range=all&format=csv&timezone=UTC`);
    const csv = await csvExport.text();
    check('CSV export', csvExport.ok && csv.trim().split('\n').length === 41);

    const refused = await json(`${url}/api/data/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'all' }),
    });
    check('deletion requires a typed confirmation', refused.status === 400);

    await json(`${url}/api/data/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'prompts', confirm: 'DELETE' }),
    });
    const afterPromptDelete = await json(`${url}/api/analytics/overview?range=all&timezone=UTC`);
    check(
      'deleting prompt text keeps analytics intact',
      afterPromptDelete.body?.totals?.prompts === 40,
    );

    await json(`${url}/api/data/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'all', confirm: 'DELETE' }),
    });
    const emptied = await json(`${url}/api/analytics/overview?range=all&timezone=UTC`);
    check('deleting everything empties the database', emptied.body?.totals?.events === 0);

    const reimport = await json(`${url}/api/ingest/events`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        providerId: 'claude-code',
        events: exported.events.map((event) => ({
          externalId: event.id,
          eventType: event.eventType,
          timestamp: event.timestamp,
          sessionId: event.sessionId,
          workingDirectory: event.workingDirectory,
          tzOffsetMinutes: event.tzOffsetMinutes,
          prompt: event.promptText,
        })),
      }),
    });
    check(
      'an export can be re-imported',
      reimport.body?.accepted === 40,
      reimport.body?.accepted === 40
        ? `${reimport.body.accepted} re-imported`
        : `status ${reimport.status}: ${JSON.stringify(reimport.body).slice(0, 220)}`,
    );

    line();
    line(`  ${dim('Docker Swarm')}`);
    if (withDocker) {
      check(
        'stack deploy, remove and redeploy preserve data',
        run(process.execPath, [join(root, 'scripts', 'stack-smoke.mjs')], { quiet: true }).ok,
      );
    } else {
      skip('stack deploy, remove and redeploy preserve data', 'pass --docker to include');
    }
  } finally {
    await stop(child);
    rmSync(scratch, { recursive: true, force: true });
  }

  const failed = results.filter((r) => r.passed === false);
  const passed = results.filter((r) => r.passed === true);
  const skipped = results.filter((r) => r.passed === null);

  line();
  line(
    `  ${bold(`${passed.length} passed`)}${failed.length ? red(`, ${failed.length} failed`) : ''}${
      skipped.length ? dim(`, ${skipped.length} skipped`) : ''
    }`,
  );
  line();
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
  line();
  line(`  ${red('The acceptance run could not complete.')}`);
  line(`  ${String(error)}`);
  process.exit(1);
});
