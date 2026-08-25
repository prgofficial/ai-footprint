const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LEN = 10;
const RANDOM_LEN = 16;

function encodeTime(now: number): string {
  let out = '';
  let value = now;
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    out = ENCODING[value % 32] + out;
    value = Math.floor(value / 32);
  }
  return out;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function encodeRandom(): string {
  const bytes = randomBytes(RANDOM_LEN);
  let out = '';
  for (let i = 0; i < RANDOM_LEN; i++) {
    out += ENCODING[(bytes[i] as number) % 32];
  }
  return out;
}

/**
 * Lexicographically sortable, time-prefixed id. Used for event ids so that ordering by
 * primary key is ordering by time, which keyset pagination depends on.
 */
export function ulid(seedTime: number = Date.now()): string {
  return encodeTime(seedTime) + encodeRandom();
}

export function ulidTimestamp(id: string): number | null {
  if (id.length < TIME_LEN) return null;
  let value = 0;
  for (let i = 0; i < TIME_LEN; i++) {
    const index = ENCODING.indexOf(id[i] as string);
    if (index < 0) return null;
    value = value * 32 + index;
  }
  return value;
}
