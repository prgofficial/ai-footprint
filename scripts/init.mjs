#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { banner, dim, fail, line, ok, step, warn } from './lib/console.mjs';
import {
  MINIMUM_NODE,
  appDirectory,
  buildArtifactsExist,
  detectPlatform,
  dockerAvailable,
  ensureAppDirectory,
  findFreePort,
  nodeMajor,
  npmCommand,
  repoRoot,
  run,
  spawnStreaming,
  swarmActive,
  waitForHealth,
} from './lib/env.mjs';

const DEFAULT_PORT = 4173;
const STACK_NAME = 'ai-footprint';

const args = new Set(process.argv.slice(2));
const useDocker = args.has('--docker');
const skipBuild = args.has('--no-build');
const detached = args.has('--detach') || args.has('-d');

const TOTAL = useDocker ? 9 : 7;
const root = repoRoot();

function checkNode(index) {
  step(index, TOTAL, `Checking Node.js on ${detectPlatform()}`);
  if (nodeMajor() < MINIMUM_NODE) {
    fail(`Node.js ${MINIMUM_NODE} or newer is required (found ${process.versions.node}).`, [
      'Install a supported version from https://nodejs.org/en/download',
      'Then run this command again.',
    ]);
  }
  ok(`Node ${process.versions.node}`);
}

function checkDependencies(index) {
  step(index, TOTAL, 'Checking dependencies');
  if (!existsSync(join(root, 'node_modules'))) {
    line(`      ${dim('Installing for the first time. This takes a minute.')}`);
    const install = run(npmCommand(), ['install', '--no-audit', '--no-fund'], { cwd: root });
    if (!install.ok) {
      fail('Dependencies could not be installed.', [
        'Run "npm install" here and read the error it prints.',
        'A corporate proxy or an offline machine is the usual cause.',
      ]);
    }
  }
  ok('Dependencies present');
}

function prepareDataDirectory(index) {
  step(index, TOTAL, 'Preparing the data directory');
  let directory;
  try {
    directory = ensureAppDirectory();
  } catch (error) {
    fail('The AI Footprint data directory could not be created.', [
      `Tried: ${appDirectory()}`,
      `Reason: ${error instanceof Error ? error.message : String(error)}`,
      'Check the permissions on your home directory, or set AI_FOOTPRINT_HOME to another path.',
    ]);
  }
  ok(directory);
  return directory;
}

function buildIfNeeded(index) {
  step(index, TOTAL, 'Building the application');
  if (skipBuild || buildArtifactsExist(root)) {
    ok(skipBuild ? 'Skipped (--no-build)' : 'Existing build found');
    return;
  }
  const build = run(npmCommand(), ['run', 'build'], { cwd: root });
  if (!build.ok) {
    fail('The build failed.', [
      'Run "npm run build" here to see the full output.',
      'If it mentions better-sqlite3, your platform may need build tools installed.',
    ]);
  }
  ok('Built');
}

async function choosePort(index) {
  step(index, TOTAL, 'Choosing a port');
  const port = await findFreePort(DEFAULT_PORT);
  if (!port) {
    fail(`No free port was found between ${DEFAULT_PORT} and ${DEFAULT_PORT + 49}.`, [
      'Close whatever is holding those ports, or set AI_FOOTPRINT_PORT to a specific one.',
    ]);
  }
  if (port !== DEFAULT_PORT) warn(`${DEFAULT_PORT} is in use — using ${port} instead`);
  else ok(String(port));
  return port;
}

async function runNative() {
  let index = 1;
  checkNode(index++);
  checkDependencies(index++);
  const dataDirectory = prepareDataDirectory(index++);
  buildIfNeeded(index++);
  const port = await choosePort(index++);

  step(index++, TOTAL, 'Starting AI Footprint');
  const child = spawnStreaming(process.execPath, [join(root, 'apps', 'api', 'dist', 'main.js')], {
    cwd: root,
    env: { ...process.env, AI_FOOTPRINT_PORT: String(port), AI_FOOTPRINT_MODE: 'native' },
    stdio: detached ? 'ignore' : 'inherit',
    detached,
  });

  if (detached) {
    child.unref();
    step(index, TOTAL, 'Waiting for the service to become healthy');
    const health = await waitForHealth(`http://127.0.0.1:${port}/api/health`, {
      timeoutMs: 60_000,
    });
    if (!health) {
      fail('AI Footprint started but never became healthy.', [
        `Check the log at ${join(dataDirectory, 'logs')}`,
      ]);
    }
    ok('Healthy');
    banner({ url: `http://localhost:${port}`, dataDirectory, mode: 'native' });
    return;
  }

  // The child prints its own banner once it is listening; relay its exit code.
  const forward = (signal) => () => child.kill(signal);
  process.on('SIGINT', forward('SIGINT'));
  process.on('SIGTERM', forward('SIGTERM'));
  child.on('exit', (code) => process.exit(code ?? 0));
}

function ensureSwarm(index) {
  step(index, TOTAL, 'Checking Docker Swarm');
  if (swarmActive()) {
    ok('Swarm already initialised');
    return;
  }
  const init = run('docker', ['swarm', 'init'], { quiet: true });
  if (!init.ok && !swarmActive()) {
    fail('Docker Swarm could not be initialised.', [
      'Run "docker swarm init" and read the error it prints.',
      'On a machine with several network interfaces you may need "docker swarm init --advertise-addr <ip>".',
    ]);
  }
  ok('Swarm initialised');
}

async function runDocker() {
  let index = 1;
  checkNode(index++);

  step(index++, TOTAL, 'Checking Docker');
  const docker = dockerAvailable();
  if (!docker.available) {
    fail(docker.reason, [
      'Install Docker from https://docs.docker.com/get-docker/ and start it,',
      'or run "sh init.sh" without --docker to use the native path instead.',
    ]);
  }
  ok(`Docker server ${docker.version}`);

  ensureSwarm(index++);
  const dataDirectory = prepareDataDirectory(index++);

  if (detectPlatform() !== 'Linux') {
    warn(
      `On ${detectPlatform()}, Docker passes your home directory through a virtualised filesystem.`,
    );
    line(`      ${dim('SQLite runs in rollback-journal mode there, which is slower but safe.')}`);
    line(`      ${dim('Native mode ("sh init.sh") avoids this entirely.')}`);

    // Docker Desktop and colima expose only part of the host filesystem to their VM.
    // A bind mount outside it is rejected at deploy time with an obscure error.
    if (!dataDirectory.startsWith(homedir())) {
      fail(`Docker cannot bind-mount ${dataDirectory} on ${detectPlatform()}.`, [
        'Docker only shares part of your filesystem with its virtual machine, and this path is outside it.',
        `Unset AI_FOOTPRINT_HOME to use the default under ${homedir()},`,
        "or add this path to Docker's file sharing settings.",
      ]);
    }
  }

  step(index++, TOTAL, 'Building the image');
  // docker stack deploy ignores `build:`, so Swarm can only consume a pre-built image.
  const build = run(process.execPath, [join(root, 'scripts', 'docker-build.mjs')], { cwd: root });
  if (!build.ok) {
    fail('The Docker image could not be built.', ['Run "npm run docker:build" to see the output.']);
  }
  ok('Image built');

  const port = await choosePort(index++);

  step(index++, TOTAL, 'Deploying the stack');
  const deploy = run(
    'docker',
    ['stack', 'deploy', '--detach=true', '-c', join(root, 'docker', 'stack.yml'), STACK_NAME],
    {
      cwd: root,
      env: {
        ...process.env,
        AI_FOOTPRINT_PORT: String(port),
        AI_FOOTPRINT_DATA: dataDirectory,
      },
    },
  );
  if (!deploy.ok) {
    fail('The stack could not be deployed.', [
      `Run "docker stack deploy -c docker/stack.yml ${STACK_NAME}" to see the error.`,
    ]);
  }
  ok(`Stack ${STACK_NAME} deployed`);

  step(index++, TOTAL, 'Waiting for the service to become healthy');
  const health = await waitForHealth(`http://127.0.0.1:${port}/api/health`, { timeoutMs: 180_000 });
  if (!health) {
    fail('The stack deployed but never became healthy.', [
      `Run "docker stack services ${STACK_NAME}" to see its state,`,
      `then "docker service logs ${STACK_NAME}_app" to read the log.`,
    ]);
  }
  ok(`Healthy — version ${health.version}`);

  banner({ url: `http://localhost:${port}`, dataDirectory, mode: 'docker' });
  line(`  ${dim('Status ')} docker stack services ${STACK_NAME}`);
  line(`  ${dim('Stop   ')} docker stack rm ${STACK_NAME}`);
  line(`  ${dim('Your data survives both. It lives on the host, not in the container.')}`);
  line();
}

async function main() {
  line();
  if (useDocker) await runDocker();
  else await runNative();
}

main().catch((error) => {
  fail('AI Footprint could not start.', [error instanceof Error ? error.message : String(error)]);
});
