import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.AI_FOOTPRINT_E2E_PORT ?? 4321);
// A throwaway data directory, so an end-to-end run can never touch real history.
const HOME = process.env.AI_FOOTPRINT_E2E_HOME ?? mkdtempSync(join(tmpdir(), 'af-e2e-'));

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node ${join(here, '..', 'api', 'dist', 'main.js')}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      AI_FOOTPRINT_HOME: HOME,
      AI_FOOTPRINT_PORT: String(PORT),
      AI_FOOTPRINT_TZ: 'UTC',
      CLAUDE_CONFIG_DIR: join(HOME, 'fake-claude'),
      AI_FOOTPRINT_LOG_LEVEL: 'warn',
    },
  },
});
