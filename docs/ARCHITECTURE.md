# Architecture

## Shape

```text
┌──────────────────────── your machine ────────────────────────┐
│                                                              │
│  Claude Code ──writes──▶ ~/.claude/projects/**/*.jsonl       │
│       │                        │                             │
│       │ optional hook          │ incremental, resumable read │
│       ▼                        ▼                             │
│  POST /api/ingest/hook   Transcript collector                │
│       │                        │                             │
│       └──────────┬─────────────┘                             │
│                  ▼                                           │
│          Normalizer → AIEvent (provider-agnostic)            │
│                  ▼                                           │
│          Ingest: redact · dedupe · upsert · batch            │
│                  ▼                                           │
│          Enrichment: classify · technologies · contexts      │
│                  ▼                                           │
│      ┌──── SQLite (WAL) + FTS5 ────┐                         │
│      │  ~/.ai-footprint/data/app.db │                        │
│      └─────────────┬────────────────┘                        │
│                    ▼                                         │
│          Daily rollups → analytics engine                    │
│                    ▼                                         │
│          NestJS on 127.0.0.1:4173                            │
│           ├── /api/*  REST                                   │
│           └── /*      built React SPA                        │
│                    ▼                                         │
│          Browser — React + TanStack Query                    │
│                                                              │
│  Nothing crosses this boundary. No outbound calls at all.    │
└──────────────────────────────────────────────────────────────┘
```

## One origin

NestJS serves the built SPA and the API on a single port. `/api/*` is the API; everything
else falls through to `index.html`.

This removes CORS entirely (it is deny-all), removes the bootstrap round-trip a browser would
otherwise need to find the backend, removes `vite preview` from production, and reduces the
Docker stack to one service. The same build runs in Docker and natively because the API base
URL is the empty string.

`GET /api/system/config` still exists and still reports version, capabilities, providers and
paths. It is simply no longer needed to locate the API.

## Collecting from Claude Code

Claude Code hooks carry **no token usage, no model and no cost** — the official reference is
explicit about it. A hooks-only collector could not answer half the questions the product
exists to answer, and it would start from an empty database.

So collection is three tiers, transcript-first:

| Tier | Source | Gives |
| --- | --- | --- |
| **A — transcripts** (primary) | `~/.claude/projects/**/*.jsonl` | Prompts, responses, model, full usage including cache reads and writes, tool calls, subagents, working directory, git branch, compaction, errors — and the entire history from the first second |
| **B — hooks** (optional) | `~/.claude/settings.json` | A sub-second "something happened" nudge and session lifecycle. No usage data. |
| **C — OTLP** | *Not built.* It was planned and is not shipped; nothing in the product listens for OTLP. Cost is estimated from token counts instead (see below). |

Tier A needs no change to the user's Claude Code configuration at all.

The transcript format is internal to Claude Code and can change. The parser is built for
that: unknown record types are skipped and counted, a missing field never throws, every line
is wrapped individually, each event records the Claude Code version that produced it, and a
drift detector watches field coverage and raises a visible, non-fatal warning when it drops.

### Reading a 2 GB corpus

Transcripts on a real machine reach 300 MB each. The reader:

- streams from a byte offset rather than loading the file,
- consumes only up to the last newline, so a line still being written is re-read next pass
  instead of being skipped,
- stores a watermark per file (`byte_offset`, `size`, `mtime`, hash of the first 4 KB) so a
  scan resumes exactly where it stopped and can tell an append from a rewrite,
- yields between chunks so the API stays responsive,
- and can be cancelled at any point.

On the machine this was developed against, 2,916 transcripts totalling 2.2 GB import to
321,882 events in about 40 seconds.

## Idempotency

Every event carries a `dedupeKey`: `sha256(provider | externalId | eventType | timestamp |
discriminator)`, with a `UNIQUE` index. Ingest inserts on conflict-do-nothing and, when a
row already exists, updates only the columns a later sighting can legitimately improve
(model, tokens, cost, session, project).

A full re-scan, a hook retry, a crash mid-backfill and a stack redeploy are therefore all
safe: 10,000 events ingested twice produce exactly 10,000 rows, which is asserted by a test.

## Which model answered

A transcript stamps the model on the reply, never on the prompt the reply answers. Left
alone, every prompt would carry a null model, no prompt would be countable against a model,
and the model filter would empty half of every screen.

A prompt is therefore attributed to the model that answered it: the first reply after it in
the same session, on the same side of a subagent boundary, skipping the `<synthetic>`
placeholder Claude Code writes for its own generated messages. A prompt that was never
answered keeps its null rather than borrowing a model from further down the file.

This runs after every ingest rather than while records are being mapped, because in the
realtime path the prompt is on disk and read seconds before the reply exists — and by then
the dedupe key above stops a re-scan from ever correcting the row. A partial index holding
only unlinked prompts keeps the pass at single-digit milliseconds; it is nearly empty in a
settled database. Existing history was corrected by `0003_prompt_model`.

Sessions are the one figure a model filter cannot take from the rollups: a session row has
no model, and the rollups count a session once per dimension it appears in. That query falls
back to the event log, the same way filtered active time does.

## Data model

Fifteen tables. The ones that carry the design:

| Table | Why it exists |
| --- | --- |
| `events` | The normalized `AIEvent`. Stores the local date, hour and weekday alongside the UTC timestamp so time-of-day analytics are correct without recomputation. |
| `prompts`, `responses` | Text lives apart from events, so "delete prompt history" is one statement that leaves every analytic intact. |
| `sessions` | Derived metrics, recomputed from events rather than accumulated, so a partial import and a finished one agree. |
| `classifications`, `technologies`, `contexts` | Enrichment output, versioned so a classifier change reprocesses only affected rows. |
| `daily_rollups`, `daily_active` | Pre-aggregated per day. Ranges beyond a week read these instead of the event log. |
| `collector_state` | Per-file watermarks. |
| `prompts_fts` | FTS5 index kept in sync by triggers. `LIKE` over this corpus is unusable. |

## Active time

Wall-clock session length is meaningless: a four-hour session with two prompts is not four
hours of AI usage. Active time is defined as

```text
active_ms = Σ over consecutive events in a session, per local day:
              min(gap, IDLE_TIMEOUT)
          + TAIL_ALLOWANCE per session-day

IDLE_TIMEOUT   = 5 minutes (configurable in Settings)
TAIL_ALLOWANCE = 60 seconds
```

The same rule is applied whether it is computed live for a short range or materialised into
`daily_active` for a long one, so the two paths always agree.

## Analytics performance

Short ranges query the event log directly — it is fast at that size and carries per-event
detail such as classifier confidence. Ranges longer than a week read the rollups, which are
rebuilt only for the `(day, provider)` pairs an ingest touched.

On 322,000 events: all-time overview 20 ms, 30-day overview 10 ms, 7-day overview 160 ms.

Activity and Prompt Explorer use keyset pagination — `(timestamp, id) < (?, ?)` — so page
500 costs the same as page 1.

## Classification

Deterministic, offline and versioned. Three weighted signals:

1. A per-category lexicon matched against the normalized prompt.
2. The imperative verb the prompt opens with. Unambiguous verbs (`fix`, `refactor`, `deploy`)
   score high; the verbs that open half of all prompts (`add`, `write`, `create`) score low.
3. **The tools Claude Code ran next.** `Edit`/`Write` means implementation. `Read`/`Grep`
   alone means research. This is the strongest signal and the one a pure text classifier
   cannot see.

The output carries a confidence. Below the threshold the answer is `Other`, and the UI says
"unclassified" rather than asserting a category it cannot support. A user override always
wins and is never recomputed. On a 159-prompt labelled fixture set the classifier scores
96.9%, and a test fails the build if it drops below 90%.

The `Classifier` interface is pluggable, so a local model could be added later — but the
product never depends on one.

## Security

- Bound to `127.0.0.1` natively. In Docker the container binds its own interfaces (the
  namespace is the boundary) and the stack publishes only to the host's loopback.
- Deny-all CORS plus an `Origin` and `Host` guard applied globally, not per route.
- Ingestion requires a token from a `0600` file.
- Every input is schema-validated before it reaches the database.
- Filesystem access driven by external data is confined by `path.resolve` prefix checks.
- Child processes are launched with an argument array; the shell is never involved.
- `fetch` is banned by lint in collector and API source.
- Logs project every object onto a key allowlist, so prompt text cannot be logged.

## Provider interface

```ts
interface AIProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly capabilities: ProviderCapabilities;

  detect(): Promise<DetectionResult>;
  connect(options, ctx): Promise<ConnectionResult>;
  disconnect(ctx): Promise<void>;

  backfill(ctx, signal: AbortSignal): AsyncIterable<number>;
  watch(ctx): Promise<Subscription | null>;

  health(ctx): Promise<ProviderHealth>;
}
```

Backfill and watch are separate because transcript-based providers are pull-based while
others are streams. Capabilities are declared rather than assumed, so the UI can be honest
about what a given tool can and cannot report.

Nothing downstream of the normalizer knows which tool an event came from.
