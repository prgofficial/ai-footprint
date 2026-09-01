-- Cost is computed once, at ingest, and stored per event. The rate card it was computed
-- against was wrong in four ways at once:
--
--   * every Opus was priced at the retired Opus 4.1 rate ($15 in / $75 out) while Opus 4.5
--     and later cost $5 / $25 — three times too high, on the model that dominates this data;
--   * Sonnet was priced at 4.6 rates and Haiku at retired 3.5 rates;
--   * Fable 5, the dearest model on the card, matched no family pattern and was counted as
--     costing nothing at all;
--   * cache writes were billed at the 5-minute multiplier (1.25x input) when Claude Code
--     writes 1-hour caches, which bill at 2x.
--
-- Pricing now keys on the model id rather than the family, and the 1-hour share of cache
-- writes is read from the transcript. Neither can be applied to stored rows in SQL — the
-- 1-hour split was never captured — so the transcripts are read again, as in 0005.
--
-- Pushed events are left alone: nothing can re-fetch those, and their cost was computed by
-- whichever card was current when they arrived.

DELETE FROM events WHERE provider_id = 'claude-code';
DELETE FROM collector_state WHERE provider_id = 'claude-code';

DELETE FROM sessions WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.session_id = sessions.id);
DELETE FROM projects WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.project_id = projects.id);

DELETE FROM daily_rollups;
DELETE FROM daily_active;
