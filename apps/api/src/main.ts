import { getLogger } from '@ai-footprint/config';
import { bootstrap, type RunningApp } from './bootstrap';

async function main(): Promise<void> {
  let running: RunningApp;
  try {
    running = await bootstrap();
  } catch (error) {
    process.stderr.write(
      `\n  AI Footprint could not start.\n  ${error instanceof Error ? error.message : String(error)}\n\n`,
    );
    process.exitCode = 1;
    return;
  }

  let shuttingDown = false;
  // Brief §41: flush and close in order, and never let a second signal skip the wait.
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    getLogger().info({ reason: signal }, 'shutting down');
    process.stdout.write('\n  Stopping AI Footprint…\n');
    try {
      await running.close();
    } catch (error) {
      getLogger().error({ err: error }, 'shutdown failed');
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('uncaughtException', (error) => {
    getLogger().error({ err: error }, 'uncaught exception');
  });
  process.on('unhandledRejection', (reason) => {
    getLogger().error({ err: reason }, 'unhandled rejection');
  });
}

void main();
