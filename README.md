# AI Footprint

**Understand how you use AI.**

Built by [Zyfolks Technologies](https://zyfolks.com) · open source under the MIT licence.

AI Footprint turns the activity your AI coding assistants already write to your own disk
into analytics about how you actually work: what you bring to AI, which projects and
technologies dominate, when you work, and how that changes over time.

It runs entirely on your machine. No account, no API key, no telemetry, no outbound
network calls of any kind.

```bash
git clone <repository>
cd ai-footprint
sh init.sh
```

That is the whole setup. No `.env`, no ports to pick, no database to create.

---

## Contents

- [What it is](#what-it-is)
- [Privacy model](#privacy-model)
- [Quick start](#quick-start)
- [macOS and Linux](#macos-and-linux)
- [Windows](#windows)
- [Docker Swarm](#docker-swarm)
- [Without Docker](#without-docker)
- [Supported integrations](#supported-integrations)
- [Where your data lives](#where-your-data-lives)
- [Architecture](#architecture)
- [Development](#development)
- [Contributing](#contributing)

---

## What it is

Connect a tool once and AI Footprint answers questions a billing page cannot:

- How much am I using AI, and is that going up or down?
- What do I actually bring to it — debugging, implementation, research, review?
- Which projects and technologies dominate my AI usage?
- When during the day do I lean on it most?
- How long are my sessions, and how much of that is real working time?
- What do I keep asking again?

Eleven surfaces: a dashboard, an activity feed, a searchable prompt history, prompt
analytics, project and session analytics, insights, a personal usage profile, connections
and settings.

Every number comes from your own events. There is no sample data anywhere in the product.

## Privacy model

**No user data leaves your machine.** This is enforced, not promised:

- The HTTP server binds to `127.0.0.1`. CORS is deny-all and any request carrying a foreign
  `Origin` is rejected, which also defeats DNS rebinding.
- Ingestion requires a token generated at first start and stored `0600` in
  `~/.ai-footprint/config/runtime.json`.
- A lint rule forbids `fetch` in the collector and API source. There is no code path out.
- Prompts and responses are scanned for credentials and **redacted before they are written**.
  API keys, tokens, JWTs, private keys and connection-string passwords become
  `[redacted:aws_access_key]` and the count is shown in the UI.
- Logs use a key allowlist. Prompt text cannot reach a log file even by mistake.
- Your Claude Code transcripts are read **read-only**. AI Footprint never writes there.
- Optional **metadata-only mode** stores no prompt text at all — only lengths, categories,
  technologies and metrics.

You can export everything as JSON or CSV, and delete everything, or just the prompt text,
at any time from Settings.

## Quick start

Requires **Node.js 20 or newer**. Nothing else.

```bash
git clone <repository>
cd ai-footprint
sh init.sh
```

`init.sh` detects your platform, creates the data directory, builds the application, picks a
free port, runs migrations and starts the app, then prints the URL. If anything is missing it
tells you exactly what to do about it.

Open the URL it prints, click **Connect Claude Code**, and your history imports in the
background. On a machine with 2 GB of Claude Code transcripts that takes about 40 seconds.

## macOS and Linux

```bash
sh init.sh              # start (native, recommended)
sh init.sh --docker     # start via Docker Swarm
sh init.sh --detach     # start in the background and return
```

## Windows

PowerShell 5.1 or 7, no extra tooling:

```powershell
.\init.ps1
.\init.ps1 --docker
```

Data is stored under `%APPDATA%\ai-footprint\`. If PowerShell blocks the script, either run
`node scripts\init.mjs` directly or allow it for this session:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

## Docker Swarm

AI Footprint deploys as a Docker **Stack** on Swarm. There is no Docker Compose file in this
project and there must not be one.

```bash
sh init.sh --docker
```

which is equivalent to:

```bash
docker swarm init                                    # once, if not already initialised
npm run docker:build                                 # stack deploy cannot build images
docker stack deploy -c docker/stack.yml ai-footprint
docker stack services ai-footprint                   # status
docker stack rm ai-footprint                         # stop
```

The database lives on the host, bind-mounted into the container, so `stack rm` followed by
`stack deploy` keeps every event. That is verified by `node scripts/stack-smoke.mjs`, which
ingests, tears the stack down, redeploys and compares the counts.

**Native mode is the default, and on macOS and Windows it is the better choice.** Docker
passes your home directory through a virtualised filesystem where SQLite's write-ahead log is
not safe, so the container falls back to a slower rollback journal. Native mode has neither
problem and gives the collector direct access to your files. Docker mode on Linux is
first-class. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full reasoning.

## Without Docker

```bash
npm install
npm run app
```

One terminal, one process, one URL:

```text
  AI Footprint
  Understand how you use AI.

  App   http://localhost:4173
  Data  /Users/you/.ai-footprint
  Mode  native
```

If 4173 is taken, the next free port is chosen automatically and printed.

## Supported integrations

| Tool | Status | What is collected |
| --- | --- | --- |
| **Claude Code** | Supported | Prompts, responses, model, full token usage including cache reads and writes, tool calls, subagent activity, compaction, session lifecycle, working directory, git branch |
| Cursor, Copilot, Gemini, Codex | Not built | The provider interface is in place for them |

Claude Code needs **no configuration change**. AI Footprint reads the transcripts it already
writes to `~/.claude/projects/`. Realtime hooks are optional; if you enable them, your
existing hooks are preserved and disconnecting removes only the entry AI Footprint added.

## Where your data lives

| Platform | Location |
| --- | --- |
| macOS, Linux | `~/.ai-footprint/` |
| Windows | `%APPDATA%\ai-footprint\` |

```text
.ai-footprint/
├── data/app.db        SQLite database
├── backups/           timestamped copies taken before any migration
├── logs/              operational logs, rotated daily, never prompt text
├── config/            runtime.json (port, ingest token) — mode 0600
└── cache/
```

Nothing is ever written inside the repository. Set `AI_FOOTPRINT_HOME` to move it.

## Architecture

```text
Claude Code ──writes──▶ ~/.claude/projects/**/*.jsonl
                              │  read-only, incremental, resumable
                              ▼
                        Collector ──▶ normalized AIEvent ──▶ redact ──▶ SQLite (+ FTS5)
                                                                          │
                                                            rollups ──▶ analytics
                                                                          ▼
                                                    NestJS on 127.0.0.1:4173
                                                     ├── /api/*  REST
                                                     └── /*      built React SPA
```

One process, one port, one origin. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the
detail, and [docs/DESIGN.md](docs/DESIGN.md) for how the interface is put together.

## Development

```bash
npm install
npm run dev          # API with reload + Vite dev server, /api proxied
npm run app          # production build, single process
npm run build        # build everything
npm run test         # unit and integration tests
npm run test:e2e     # Playwright, including an accessibility audit
npm run lint         # ESLint
npm run format       # Prettier
npm run typecheck    # TypeScript, all workspaces
npm run hygiene      # repository hygiene checks
npm run acceptance   # the full acceptance run
```

```text
apps/api          NestJS: REST API, collectors, static SPA host
apps/web          React, Vite, Tailwind, TanStack Query, Recharts
packages/shared   event contract, enums, schemas, API types
packages/config   OS-aware paths, ports, runtime config, logging
packages/database Drizzle schema, migrations, repositories
packages/analytics classification, technology detection, redaction, pricing
packages/collectors provider interface and the Claude Code adapter
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports go through
[SECURITY.md](SECURITY.md). Licensed under the [MIT License](LICENSE).

---

<p align="center">
  Built and open-sourced by <a href="https://zyfolks.com"><strong>Zyfolks Technologies</strong></a><br />
  <sub><a href="https://zyfolks.com">zyfolks.com</a></sub>
</p>
