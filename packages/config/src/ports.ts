import { createServer } from 'node:net';

export async function isPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen({ port, host, exclusive: true });
  });
}

/**
 * Brief §50: the default port is not guaranteed. Scan upward rather than failing, so the
 * user never has to edit configuration when something else already holds 4173.
 */
export async function findFreePort(
  preferred: number,
  attempts = 50,
  host = '127.0.0.1',
): Promise<number> {
  for (let i = 0; i < attempts; i++) {
    const candidate = preferred + i;
    if (candidate > 65535) break;
    if (await isPortFree(candidate, host)) return candidate;
  }
  throw new Error(
    `No free port found between ${preferred} and ${Math.min(preferred + attempts - 1, 65535)}`,
  );
}
