import { describe, expect, it } from 'vitest';
import { createServer } from 'node:net';
import { findFreePort, isPortFree } from './ports';

function occupy(port: number): Promise<() => Promise<void>> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen({ port, host: '127.0.0.1' }, () => {
      resolve(() => new Promise<void>((done) => server.close(() => done())));
    });
  });
}

describe('port selection', () => {
  it('skips an occupied port and returns the next free one', async () => {
    const base = await findFreePort(45000);
    const release = await occupy(base);
    try {
      expect(await isPortFree(base)).toBe(false);
      const next = await findFreePort(base);
      expect(next).toBeGreaterThan(base);
    } finally {
      await release();
    }
  });
});
