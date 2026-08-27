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
    pattern:
      /\b([A-Z0-9_]*(?:API_KEY|APIKEY|SECRET|SECRET_KEY|ACCESS_TOKEN|AUTH_TOKEN|PASSWORD|PASSWD|PRIVATE_KEY|CLIENT_SECRET)[A-Z0-9_]*)\s*[=:]\s*["']?([^\s"'`,;]{8,})["']?/gi,
    group: 2,
  },
];

const PLACEHOLDER_LIKE =
  /^(?:x{3,}|\*{3,}|<[^>]+>|\$\{[^}]+\}|your[_-]?\w*|changeme|example|placeholder|redacted|null|undefined|true|false)$/i;

function looksLikePlaceholder(value: string): boolean {
  return PLACEHOLDER_LIKE.test(value.trim());
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
