export interface RedactionResult {
  text: string;
  count: number;
  kinds: string[];
}

interface Rule {
  kind: string;
  pattern: RegExp;
  /** Which capture group holds the secret; 0 means the whole match. */
  group?: number;
}

/**
 * Plan §2.5: prompts routinely contain credentials, and this database is plain text on
 * disk. Redaction runs before anything is persisted, never after.
 */
const RULES: Rule[] = [
  { kind: 'aws_access_key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  {
    kind: 'aws_secret',
    pattern: /\b(?:aws_secret_access_key\s*[=:]\s*)([A-Za-z0-9/+=]{40})\b/gi,
    group: 1,
  },
  { kind: 'anthropic_key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { kind: 'openai_key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { kind: 'github_token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { kind: 'slack_token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: 'google_api_key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: 'stripe_key', pattern: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { kind: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  {
    kind: 'private_key',
    pattern: /-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z]*PRIVATE KEY-----/g,
  },
  {
    kind: 'connection_string',
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)([^\s@/]+)(@)/gi,
    group: 2,
  },
  { kind: 'bearer_token', pattern: /\b(?:Bearer|Token)\s+([A-Za-z0-9._~+/=-]{16,})/g, group: 1 },
  { kind: 'basic_auth', pattern: /\bBasic\s+([A-Za-z0-9+/=]{16,})/g, group: 1 },
  {
    kind: 'assigned_secret',
    // The key may be quoted (`"apiKey": "..."`), hyphenated (`x-api-key: ...`) or plain
    // (`OPENAI_API_KEY=...`), because a config blob and a header dump are two of the most
    // common things anyone pastes into a prompt. Matching only the bare-uppercase form left
    // every JSON credential in the database in plaintext, counted as nothing redacted.
    pattern:
      /["'`]?\b([A-Za-z0-9_-]*(?:API[_-]?KEY|SECRET|SECRET[_-]?KEY|ACCESS[_-]?TOKEN|AUTH[_-]?TOKEN|PASSWORD|PASSWD|PRIVATE[_-]?KEY|CLIENT[_-]?SECRET|CREDENTIAL|SESSION[_-]?TOKEN)[A-Za-z0-9_-]*)\b["'`]?\s*[=:]\s*["'`]?([^\s"'`,;}\]]{8,})["'`]?/gi,
    group: 2,
  },
];

const PLACEHOLDER_LIKE =
  // `\$\{...\}?` allows the closing brace to be absent: a value stops at `}` so that a JSON
  // object does not swallow the rest of the blob, which clips `${GITHUB_TOKEN}` on the way in.
  /^(?:x{3,}|\*{3,}|<[^>]+>|\$\{[^}]*\}?|%[A-Z_]+%|your[_-]?\w*|changeme|example|placeholder|redacted|null|undefined|true|false)$/i;

function looksLikePlaceholder(value: string): boolean {
  const trimmed = value.trim();
  // A later rule must not redact what an earlier rule already replaced, or the placeholder
  // itself is treated as the secret and the output is mangled.
  if (trimmed.startsWith('[redacted:')) return true;
  return PLACEHOLDER_LIKE.test(trimmed);
}

/**
 * Redacts every string in an arbitrary structure. `metadata` is where an adapter puts extra
 * context (editor selection, headers, an env snapshot), so it is where credentials arrive.
 */
export function redactDeep(value: unknown): { value: unknown; count: number; kinds: string[] } {
  const kinds = new Set<string>();
  let count = 0;

  const walk = (node: unknown, depth: number): unknown => {
    if (depth > 12) return node;
    if (typeof node === 'string') {
      const result = redact(node);
      count += result.count;
      for (const kind of result.kinds) kinds.add(kind);
      return result.text;
    }
    if (Array.isArray(node)) return node.map((item) => walk(item, depth + 1));
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(node as Record<string, unknown>)) {
        out[key] = walk(item, depth + 1);
      }
      return out;
    }
    return node;
  };

  return { value: walk(value, 0), count, kinds: [...kinds] };
}

export function redact(input: string | null | undefined): RedactionResult {
  if (!input) return { text: input ?? '', count: 0, kinds: [] };

  let text = input;
  let count = 0;
  const kinds = new Set<string>();

  for (const rule of RULES) {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    text = text.replace(pattern, (match, ...groups) => {
      const groupIndex = rule.group ?? 0;
      const secret = groupIndex === 0 ? match : (groups[groupIndex - 1] as string | undefined);
      if (!secret || looksLikePlaceholder(secret)) return match;
      count += 1;
      kinds.add(rule.kind);
      const replacement = `[redacted:${rule.kind}]`;
      return groupIndex === 0 ? replacement : match.replace(secret, replacement);
    });
  }

  return { text, count, kinds: [...kinds] };
}
