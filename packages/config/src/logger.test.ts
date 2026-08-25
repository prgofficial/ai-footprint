// hygiene:allow-secret-fixtures: these are published example credentials used to
// prove the redactor removes them. They grant no access to anything.
import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import pino from 'pino';
import { redactionHooks } from './logger';

function capture(): { stream: Writable; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  return { stream, lines };
}

describe('log redaction allowlist', () => {
  it('drops prompt, response and credential fields entirely', () => {
    const { stream, lines } = capture();
    const log = pino({ hooks: redactionHooks, base: null }, stream);

    log.info(
      {
        providerId: 'claude-code',
        prompt: 'my aws key is AKIAIOSFODNN7EXAMPLE',
        response: 'here is your source code',
        apiKey: 'sk-secret',
        password: 'hunter2',
        env: { SECRET: 'x' },
        eventCount: 3,
      },
      'ingest complete',
    );

    const output = lines.join('');
    expect(output).toContain('claude-code');
    expect(output).toContain('"eventCount":3');
    expect(output).not.toContain('AKIA');
    expect(output).not.toContain('source code');
    expect(output).not.toContain('sk-secret');
    expect(output).not.toContain('hunter2');
  });

  it('drops unknown top-level keys rather than trusting the call site', () => {
    const { stream, lines } = capture();
    const log = pino({ hooks: redactionHooks, base: null }, stream);
    log.info({ somethingNobodyReviewed: 'leaked' }, 'hello');
    expect(lines.join('')).not.toContain('leaked');
  });
});
