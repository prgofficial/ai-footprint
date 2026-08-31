# Sending another tool's activity to AI Footprint

AI Footprint reads **Claude Code** by itself, from the transcripts Claude Code already writes to
your disk. It is the only tool it knows how to read unaided.

Everything else — Cursor, Copilot, Gemini CLI, Codex, an internal tool, something you write this
afternoon — sends its own events to one HTTP endpoint. There is no adapter to write and nothing
to register in advance: the first event from a new `providerId` creates it.

Everything on this page runs against `127.0.0.1`. Nothing leaves the machine.

## The endpoint

```
POST http://127.0.0.1:<port>/api/ingest/events
Content-Type: application/json
x-ai-footprint-token: <token>
```

Both values are in the runtime file AI Footprint writes on every start:

```bash
cat ~/.ai-footprint/config/runtime.json
# { "port": 4173, "ingestToken": "…", … }
```

The file is `0600`. The token is the only credential; the endpoint also refuses any request that
arrives with a foreign `Origin` or a non-localhost `Host`.

## A minimal, correct batch

```json
{
  "providerId": "cursor",
  "events": [
    {
      "externalId": "cur-2026-08-20-001",
      "eventType": "prompt",
      "timestamp": "2026-08-20T10:00:00.000Z",
      "sessionId": "conversation-42",
      "prompt": "refactor the auth guard to use the new context",
      "workingDirectory": "/Users/you/code/shop-frontend",
      "tzOffsetMinutes": 330
    },
    {
      "externalId": "cur-2026-08-20-002",
      "eventType": "response",
      "timestamp": "2026-08-20T10:00:21.000Z",
      "sessionId": "conversation-42",
      "model": "gpt-5",
      "inputTokens": 1240,
      "outputTokens": 380,
      "cacheReadTokens": 8100,
      "workingDirectory": "/Users/you/code/shop-frontend",
      "tzOffsetMinutes": 330
    }
  ]
}
```

Response:

```json
{ "accepted": 2, "deduped": 0, "failed": 0, "skipped": 0, "batchId": "01M1…" }
```

- **accepted** — stored.
- **deduped** — already present. Re-sending is safe and is the intended way to recover.
- **failed** — rejected by the schema. The rest of the batch still lands.
- **skipped** — the provider is paused in Settings. Not an error.

Up to **2000 events** per batch, up to **32 MB** of body.

## The fields that matter

| Field | Why it earns its place |
| --- | --- |
| `externalId` | **Send it.** It is what makes re-sending safe. Without one, AI Footprint synthesises an identity from the event's own content — correct, but it cannot tell a genuine retry from a genuinely repeated event. |
| `eventType` | `prompt`, `response`, `tool_call`, `session_start`, `session_end`, `compaction`, `error`, `notification`. |
| `timestamp` | ISO-8601. Years outside 0001–9999 are rejected. |
| `sessionId` | Your own id for the conversation. Scoped to your `providerId`, so it cannot collide with another tool's. |
| `tzOffsetMinutes` | The offset **at that instant**, e.g. `330` for IST. Omit it and the app applies the configured timezone at that instant instead — correct, but yours is better. |
| `workingDirectory` | How projects are inferred. An absolute path is walked up to the nearest `.git`. A path from another OS (`C:\…`) is kept as-is and named from its last segment. |
| `model` | Put it on the **response**, as the transcript formats do. A prompt with no model is attributed to the model of the reply that follows it. |
| `inputTokens` / `outputTokens` / `cacheReadTokens` / `cacheWriteTokens` | Drive the token and cost figures. |
| `prompt` / `response` | Text. Redacted before storage, including anything nested in `metadata`. |
| `metadata` | Anything else, as JSON. Also redacted. |

`providerId` may be set per event as well as per batch, so one batch can carry several tools.
That is what makes an export re-importable.

## Cost

Cost is estimated locally from token counts and a small table of published list prices, which
currently covers Anthropic's opus, sonnet and haiku families. **A model outside that table
reports `null`, never `0`** — unknown and free are not the same thing, and the UI says so. There
are no network calls to look a price up.

## Things worth knowing

- **Pausing works.** Settings → Providers pauses a push source as surely as a pulled one;
  events sent while paused come back as `skipped`.
- **Idempotency is per provider.** Two tools may use the same `externalId` or `sessionId`
  without colliding.
- **Ranges are local days.** An event is filed under its own local date, derived from
  `tzOffsetMinutes`.
- **Deleting from Settings clears AI Footprint's database only.** Your tool's own files are
  never touched — AI Footprint has no write path to them.

## A shell one-liner to check your wiring

```bash
HOME_DIR=~/.ai-footprint
PORT=$(node -p "require('$HOME_DIR/config/runtime.json').port")
TOKEN=$(node -p "require('$HOME_DIR/config/runtime.json').ingestToken")

curl -s -X POST "http://127.0.0.1:$PORT/api/ingest/events" \
  -H 'content-type: application/json' -H "x-ai-footprint-token: $TOKEN" \
  -d '{"providerId":"my-tool","events":[{"externalId":"hello-1","eventType":"prompt",
       "timestamp":"'"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"'","sessionId":"s1",
       "prompt":"hello from my tool","workingDirectory":"'"$PWD"'","tzOffsetMinutes":0}]}'
```

Open the dashboard and "My Tool" is on it.
