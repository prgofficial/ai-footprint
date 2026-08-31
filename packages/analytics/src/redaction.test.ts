// hygiene:allow-secret-fixtures, these are published example credentials used to
// prove the redactor removes them. They grant no access to anything.
import { describe, expect, it } from 'vitest';
import { redact } from './redaction';

const SECRETS: Array<[string, string, string]> = [
  ['aws_access_key', 'AKIAIOSFODNN7EXAMPLE', 'set AKIAIOSFODNN7EXAMPLE in the env'],
  [
    'anthropic_key',
    'sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345',
    'use sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345 here',
  ],
  [
    'openai_key',
    'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789',
    'OPENAI key sk-proj-abcdefghijklmnopqrstuvwxyz0123456789',
  ],
  [
    'github_token',
    'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'clone with ghp_abcdefghijklmnopqrstuvwxyz0123456789',
  ],
  [
    'github_token',
    'gho_abcdefghijklmnopqrstuvwxyz0123456789',
    'oauth gho_abcdefghijklmnopqrstuvwxyz0123456789',
  ],
  ['slack_token', 'xoxb-1234567890-abcdefghijkl', 'slack xoxb-1234567890-abcdefghijkl'],
  [
    'google_api_key',
    'AIzaSyA1234567890abcdefghijklmnopqrstuv',
    'maps AIzaSyA1234567890abcdefghijklmnopqrstuv',
  ],
  ['stripe_key', 'sk_live_abcdefghijklmnop1234', 'billing sk_live_abcdefghijklmnop1234'],
  [
    'jwt',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk',
    'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk',
  ],
];

describe('secret redaction', () => {
  it.each(SECRETS)('removes a %s from prompt text', (_kind, secret, text) => {
    const result = redact(text);
    expect(result.text).not.toContain(secret);
    expect(result.count).toBeGreaterThan(0);
    expect(result.text).toMatch(/\[redacted:[a-z_]+\]/);
  });

  it('redacts the password inside a connection string but keeps the rest readable', () => {
    const result = redact('psql postgres://appuser:sup3rS3cret@db.internal:5432/appdb');
    expect(result.text).not.toContain('sup3rS3cret');
    expect(result.text).toContain('appuser');
    expect(result.text).toContain('db.internal:5432/appdb');
  });

  it('redacts bearer and basic authorization values', () => {
    expect(redact('Authorization: Bearer abcdefghijklmnop1234567890').text).not.toContain(
      'abcdefghijklmnop',
    );
    expect(redact('Authorization: Basic dXNlcjpwYXNzd29yZDEyMw==').text).not.toContain(
      'dXNlcjpwYXNz',
    );
  });

  it('redacts assignments to obviously secret names', () => {
    const result = redact(
      'DATABASE_PASSWORD=hunter2hunter2\nSTRIPE_SECRET_KEY: "abcd1234efgh5678"',
    );
    expect(result.text).not.toContain('hunter2hunter2');
    expect(result.text).not.toContain('abcd1234efgh5678');
    expect(result.count).toBe(2);
  });

  it('strips a whole PEM block', () => {
    const pem =
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\nabc\n-----END RSA PRIVATE KEY-----';
    const result = redact(`here is the key\n${pem}\nuse it`);
    expect(result.text).not.toContain('MIIEpAIBAAKCAQEA');
    expect(result.text).toContain('here is the key');
    expect(result.text).toContain('use it');
  });

  it('leaves ordinary prose and code completely alone', () => {
    const samples = [
      'why does the login test fail on CI but pass locally',
      'const total = items.reduce((sum, item) => sum + item.price, 0);',
      'refactor UserService so it no longer depends on the HTTP layer',
      'API_URL=https://api.example.com/v1',
      'export const TIMEOUT = 5000;',
    ];
    for (const sample of samples) {
      const result = redact(sample);
      expect(result.count, sample).toBe(0);
      expect(result.text).toBe(sample);
    }
  });

  it('ignores obvious placeholders rather than pretending they were secrets', () => {
    for (const sample of [
      'API_KEY=<your-api-key>',
      'CLIENT_SECRET=changeme',
      'AUTH_TOKEN=${GITHUB_TOKEN}',
      'PASSWORD=xxxxxxxxxx',
    ]) {
      expect(redact(sample).count, sample).toBe(0);
    }
  });

  it('handles empty and missing input without throwing', () => {
    expect(redact('')).toEqual({ text: '', count: 0, kinds: [] });
    expect(redact(null)).toEqual({ text: '', count: 0, kinds: [] });
    expect(redact(undefined)).toEqual({ text: '', count: 0, kinds: [] });
  });

  it('reports every distinct kind it found', () => {
    const result = redact('AKIAIOSFODNN7EXAMPLE and ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(result.kinds.sort()).toEqual(['aws_access_key', 'github_token']);
  });
});
