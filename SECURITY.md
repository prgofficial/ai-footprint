# Security Policy

## Reporting a vulnerability

Open a private security advisory on the repository's Security tab. Please do not open a
public issue for an unfixed vulnerability.

Include the affected version, reproduction steps, and impact. You will get an
acknowledgement within seven days.

## Security model

AI Footprint runs entirely on the user's machine.

- The HTTP server binds to `127.0.0.1` only. It is never exposed on a network interface.
- CORS is deny-all. Requests carrying a cross-origin `Origin` header are rejected, which
  also defeats DNS rebinding from a browser tab.
- Ingestion endpoints require a token generated at first start and stored in
  `~/.ai-footprint/config/runtime.json` with mode `0600`.
- All input is validated with schemas before it reaches the database.
- Filesystem access driven by external data is confined to an allowlist of roots and
  resolved with prefix checks, so a crafted path cannot escape.
- Child processes are launched with an argument array. No shell string interpolation.
- The application makes no outbound network requests. This is enforced by a test.
- Prompt and response text is scanned for credentials and redacted before it is written
  to disk. Logs use a key allowlist, so prompt text cannot reach a log file at all.

## Reading Claude Code data

AI Footprint reads `~/.claude/projects/**/*.jsonl` read-only and never writes there.
`~/.claude/settings.json` is only modified when hook integration is explicitly enabled;
the original is backed up first, entries are tagged, and disconnecting removes only the
entries AI Footprint added.
