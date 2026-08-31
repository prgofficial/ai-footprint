# Privacy

AI Footprint reads your AI activity. This document says exactly what it stores, where, and
how to remove it.

## The short version

Nothing leaves your machine. There is no account, no API key, no telemetry and no outbound
network request of any kind. The application is a local web server bound to `127.0.0.1` and a
SQLite file in your home directory.

## What is stored

| Data | Stored | Notes |
| --- | --- | --- |
| Prompt text | Yes, by default | Redacted first. Can be disabled, or deleted at any time. |
| AI response text | **No**, by default | Only length. Opt in under Settings. |
| Model, tokens, estimated cost | Yes | From the transcript's own usage figures. |
| Tool names and outcomes | Yes | The tool name and whether it succeeded, not its arguments. |
| Working directory, repository, git branch | Yes | Used to infer projects without manual tagging. |
| Session and event timestamps | Yes | Plus the local offset, for time-of-day analytics. |
| Source code | **No** | Never read, never stored. |
| File contents from tool results | **No** | Discarded during parsing. |
| Environment variables | **No** | Never read. |

## Secret redaction

Prompts routinely contain credentials. A redaction pass runs **before anything is written to
disk**, not after:

AWS access keys and secrets · Anthropic, OpenAI, GitHub, Slack, Google and Stripe tokens ·
JWTs · PEM private key blocks · passwords inside connection strings · `Bearer` and `Basic`
authorization values · assignments to names such as `*_API_KEY`, `*_SECRET`, `*_TOKEN`,
`PASSWORD`.

Matches are replaced with `[redacted:aws_access_key]` and the count is stored, so the UI can
tell you "3 secrets redacted before storage". Obvious placeholders (`<your-key>`, `changeme`,
`${VAR}`) are left alone.

This is on by default and can be turned off in Settings. It is not a guarantee that every
possible secret shape is caught — it is a strong default that removes the common ones.

## Metadata-only mode

If you would rather no prompt text existed on disk at all, turn on **Metadata-only mode** in
Settings. AI Footprint then stores lengths, hashes, categories, technologies and metrics, and
never the words. Prompt search stops working; everything else continues to.

## What is read from Claude Code

- `~/.claude/projects/**/*.jsonl` — read-only. AI Footprint never writes there.
- `~/.claude/settings.json` — read always; written **only** if you explicitly enable realtime
  hooks. In that case the original is backed up first, the file is written atomically, every
  entry AI Footprint adds is tagged, and disconnecting removes only those entries. Hooks you
  or another tool installed are preserved through both operations, which is covered by a test.

## Logs

Logs go to `~/.ai-footprint/logs/`, rotate daily and keep seven days. Every logged object is
projected onto an allowlist of operational keys before it is written, so prompt text,
responses, code and credentials cannot reach a log file even from a careless call site.

## Network

The server listens on `127.0.0.1` only. CORS is deny-all, and any request carrying a foreign
`Origin` or addressed to a host other than localhost is rejected — which also defeats DNS
rebinding from a browser tab. Ingestion requires a token stored `0600` in
`~/.ai-footprint/config/runtime.json`.

A lint rule forbids `fetch` in the collector and API source, so there is no code path out of
the machine to review.

The one external address anywhere in the product is `https://zyfolks.com`, the credit in the
footer, the welcome screen and Settings. It is a plain link: nothing fetches it, and it only
opens if you click it.

## Your data, your call

From **Settings**:

- **Export** everything as JSON (with a manifest) or CSV, with or without prompt text.
- **Delete prompt text** — removes the words, keeps every analytic.
- **Delete everything** — every event, session, project and prompt, followed by a `VACUUM`.
- **Retention** — automatically clear prompt text older than N months.
- **Pause a provider** — stop collecting without losing what is already there.

Destructive actions show an exact preview and require you to type `DELETE`.

## Where it lives

| Platform | Path |
| --- | --- |
| macOS, Linux | `~/.ai-footprint/` |
| Windows | `%APPDATA%\ai-footprint\` |

To remove AI Footprint completely: disconnect the provider in the UI (this restores
`settings.json`), stop the app, then delete that directory and the cloned repository.
