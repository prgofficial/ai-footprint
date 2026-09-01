-- Claude Code's streaming writes one assistant reply to the transcript several times: distinct
-- line uuids, timestamps seconds apart, and a byte-identical `usage` payload each time. Events
-- were identified by the line rather than by the reply, so one reply became many events and
-- every token and cost figure was inflated. Measured over 130,125 real assistant records on the
-- machine this was found on: 30,362 actual replies counted as 130,125 events — 4.1x.
--
-- A reply is now identified by `message.id`, and an external id no longer carries the clock in
-- its dedupe key. Both change the key, so the stored rows can neither be repaired in place nor
-- matched against a re-scan.
--
-- The transcripts are the source of truth and are never written to, so the honest repair is to
-- forget what was derived from them and read them again. On the machine this was written for
-- that is about 40 seconds for 2.2 GB. Events pushed in over the ingest API are NOT touched:
-- nothing can re-fetch those.

DELETE FROM events WHERE provider_id = 'claude-code';

-- Watermarks record how far into each transcript the reader got. Clearing them is what makes
-- the next start re-read from the beginning.
DELETE FROM collector_state WHERE provider_id = 'claude-code';

-- Rows whose events have gone.
DELETE FROM sessions WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.session_id = sessions.id);
DELETE FROM projects WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.project_id = projects.id);

-- Both derived tables, rebuilt on the next start from whatever survives.
DELETE FROM daily_rollups;
DELETE FROM daily_active;
