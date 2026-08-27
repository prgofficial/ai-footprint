import { createHash } from 'node:crypto';

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

const CODE_FENCE = /```[\s\S]*?```/g;
const INLINE_CODE = /`[^`]*`/g;
const PATH_LIKE = /(?:[A-Za-z]:)?[\\/](?:[\w.@-]+[\\/])+[\w.@-]+/g;
const URL_LIKE = /\bhttps?:\/\/\S+/g;
const NUMBER_LIKE = /\b\d[\d.,_-]*\b/g;
const UUID_LIKE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/**
 * §6.6: "same prompt asked again" should survive a different file path, a different line
 * number and a pasted snippet, so those are stripped before fingerprinting.
 */
export function normalizeForFingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(CODE_FENCE, ' ')
    .replace(INLINE_CODE, ' ')
    .replace(URL_LIKE, ' ')
    .replace(UUID_LIKE, ' ')
    .replace(PATH_LIKE, ' ')
    .replace(NUMBER_LIKE, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function fingerprint(text: string): string {
  return sha256(normalizeForFingerprint(text));
}

export function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function preview(text: string, maxLength = 220): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, maxLength - 1)}…`;
}

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'have',
  'has',
  'are',
  'was',
  'were',
  'you',
  'your',
  'our',
  'can',
  'not',
  'but',
  'all',
  'any',
  'use',
  'using',
  'used',
  'get',
  'got',
  'set',
  'into',
  'out',
  'its',
  'it',
  'is',
  'a',
  'an',
  'to',
  'of',
  'in',
  'on',
  'at',
  'by',
  'be',
  'as',
  'or',
  'if',
  'do',
  'does',
  'did',
  'so',
  'we',
  'i',
  'me',
  'my',
  'what',
  'why',
  'how',
  'when',
  'where',
  'which',
  'who',
  'should',
  'would',
  'could',
  'make',
  'made',
  'need',
  'want',
  'please',
  'help',
  'also',
  'just',
  'like',
  'than',
  'then',
  'them',
  'they',
  'there',
  'here',
  'one',
  'two',
  'more',
  'new',
  'now',
  'see',
  'let',
  'add',
  'file',
  'files',
  'code',
  'line',
  'lines',
  'error',
  'issue',
  'problem',
  'work',
  'working',
  'create',
  'update',
  'change',
  'check',
  'look',
  'looking',
  'trying',
  'try',
  'still',
  'back',
  'after',
  'before',
  'again',
  'same',
  'other',
  'some',
  'only',
  'very',
  'much',
  'many',
  'most',
  'been',
  'being',
  'will',
  'may',
]);

export function extractThemes(texts: string[], limit = 12): Array<{ term: string; count: number }> {
  const counts = new Map<string, number>();
  for (const text of texts) {
    const seen = new Set<string>();
    for (const token of normalizeForFingerprint(text).split(' ')) {
      if (token.length < 4 || STOP_WORDS.has(token)) continue;
      if (seen.has(token)) continue;
      seen.add(token);
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term))
    .slice(0, limit);
}
