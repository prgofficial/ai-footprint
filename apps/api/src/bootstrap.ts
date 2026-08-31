import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter, type NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import {
  APP_NAME,
  APP_TAGLINE,
  DEFAULT_APP_PORT,
  INGEST_BODY_LIMIT,
  VENDOR_DOMAIN,
  VENDOR_NAME,
} from '@ai-footprint/shared';
import {
  createLogger,
  findFreePort,
  resolveIngestToken,
  setLogger,
  writeRuntimeConfig,
} from '@ai-footprint/config';
import { AppModule } from './app.module';
import {
  LocalOriginGuard,
  RuntimeService,
  StoreService,
  UserFacingExceptionFilter,
} from './common';
import { ProviderRegistry } from './providers/provider.registry';
import { EnrichmentService } from './enrichment/enrichment.service';
import { mountStaticSpa, resolveWebRoot } from './static';

export interface BootstrapOptions {
  port?: number;
  host?: string;
  webRoot?: string | null;
  logToFile?: boolean;
  printBanner?: boolean;
}

export interface RunningApp {
  app: NestExpressApplication;
  port: number;
  host: string;
  url: string;
  close(): Promise<void>;
}

export async function bootstrap(options: BootstrapOptions = {}): Promise<RunningApp> {
  const logger = createLogger({ toFile: options.logToFile ?? true });
  setLogger(logger);

  const server = express();
  server.disable('x-powered-by');

  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    new ExpressAdapter(server),
    { logger: false, bodyParser: false },
  );
  // The ingest schema documents batches of up to 2000 events; Express defaults to 100 kB, so
  // the documented maximum was unsendable and failed as an opaque 500. Sized for a full batch
  // of prompt-and-response events with room to spare.
  app.useBodyParser('json', { limit: INGEST_BODY_LIMIT });

  // Plan §2.3: same-origin only, so there is no CORS surface to get wrong.
  app.enableCors({ origin: false });
  app.useGlobalFilters(new UserFacingExceptionFilter());
  // Applied globally: a route that forgets the decorator must still be protected.
  app.useGlobalGuards(new LocalOriginGuard());
  app.enableShutdownHooks();

  const runtime = app.get(RuntimeService);
  // Brief §34 wants the API off the network. Natively that means binding loopback. Inside a
  // container the network namespace is already the boundary, and a loopback bind would make
  // the published port unreachable, so the container binds all its own interfaces and the
  // stack publishes only to the host's loopback.
  const host = options.host ?? (runtime.mode === 'docker' ? '0.0.0.0' : '127.0.0.1');
  const fromEnv = Number.parseInt(process.env.AI_FOOTPRINT_PORT ?? '', 10);
  const requested = options.port ?? (Number.isInteger(fromEnv) ? fromEnv : DEFAULT_APP_PORT);
  // Brief §50: the requested port is a preference, not a requirement.
  const port = await findFreePort(requested > 0 ? requested : DEFAULT_APP_PORT, 50, host);
  const ingestToken = resolveIngestToken(runtime.paths);

  runtime.configure({ port, host, ingestToken });

  const stores = app.get(StoreService);
  mountStaticSpa(server, resolveWebRoot(options.webRoot ?? undefined));

  await app.init();
  await app.listen(port, host);

  writeRuntimeConfig(
    {
      port,
      host,
      ingestToken,
      mode: runtime.mode,
      startedAt: new Date().toISOString(),
      stoppedAt: null,
      pid: process.pid,
      dataDirectory: runtime.paths.root,
      databasePath: stores.store.databasePath,
    },
    runtime.paths,
  );

  app.get(EnrichmentService).start();

  const registry = app.get(ProviderRegistry);
  // A previously installed hook points at whatever port the last run used. Refreshing it
  // here keeps realtime collection working when the port changes between starts.
  registry.refreshInstalledHooks();
  void registry.resumeConnected();

  const url = `http://localhost:${port}`;
  if (options.printBanner !== false) printBanner(url, runtime.paths.root, runtime.mode);
  logger.info({ port, host, mode: runtime.mode }, 'ai footprint started');

  return {
    app,
    port,
    host,
    url,
    close: async () => {
      await app.close();
    },
  };
}

function printBanner(url: string, dataDirectory: string, mode: 'native' | 'docker'): void {
  const lines = [
    '',
    `  ${APP_NAME}`,
    `  ${APP_TAGLINE}`,
    '',
    `  App    ${url}`,
    `  Data   ${dataDirectory}`,
    `  Mode   ${mode}`,
    '',
    `  Built by ${VENDOR_NAME} · ${VENDOR_DOMAIN}`,
    '',
    '  Press Ctrl+C to stop.',
    '',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}
