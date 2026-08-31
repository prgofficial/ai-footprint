-- The pre-aggregated tables are what every range longer than a week reads, and they were not
-- saying the same thing as the event log they summarise.
--
-- * `estimated_cost_usd REAL NOT NULL DEFAULT 0` erased the difference between "this model is
--   not in the pricing table" and "this cost nothing". Short ranges honestly reported null;
--   long ranges — including the default 30-day view — reported $0.00 for every model outside
--   opus/sonnet/haiku, which is every model a second tool sends.
-- * Only prompts, responses and tool calls were counted, so a tool reporting any of the five
--   other documented event types had its event count collapse toward zero and the dashboard
--   told it there was no activity.
-- * Category confidence was not carried at all, so long ranges reported 0% confidence for
--   every category while short ranges reported the real figure.
--
-- SQLite cannot drop NOT NULL in place, and the table is a derived cache, so it is replaced
-- outright and rebuilt from the events on the next start.
DROP TABLE IF EXISTS daily_rollups;

CREATE TABLE daily_rollups (
  day TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  project_id TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  prompts INTEGER NOT NULL DEFAULT 0,
  responses INTEGER NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  -- Session starts and ends, compactions, errors and notifications: counted, so the totals
  -- match COUNT(*) on the event log.
  other_events INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  -- Nullable on purpose: unknown is not free.
  estimated_cost_usd REAL,
  -- Summed, not averaged, so any set of rows can be re-averaged over its own prompt count.
  confidence_sum REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (day, provider_id, project_id, model, category)
);
CREATE INDEX daily_rollups_day_idx ON daily_rollups (day);

-- Active time is materialised per local day under whatever idle timeout was in force at
-- ingest. Rebuilding it here also clears rows left behind by deleted providers, which nothing
-- pruned.
DELETE FROM daily_active;
