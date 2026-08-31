#!/usr/bin/env node
import { join } from 'node:path';
import { fail, line, ok } from './lib/console.mjs';
import { dockerAvailable, repoRoot, run } from './lib/env.mjs';

const IMAGE = process.env.AI_FOOTPRINT_IMAGE ?? 'ai-footprint:local';
const root = repoRoot();

const docker = dockerAvailable();
if (!docker.available) fail(docker.reason, ['Start Docker, then run this again.']);

line(`  Building ${IMAGE}…`);

// `docker stack deploy` ignores the build key, so Swarm can only consume an image that
// already exists locally. Building it here is what makes the stack deployable.
const result = run('docker', [
  'build',
  '--file',
  join(root, 'docker', 'Dockerfile.app'),
  '--tag',
  IMAGE,
  root,
]);

if (!result.ok) fail('The image failed to build.');
ok(`${IMAGE} built`);
