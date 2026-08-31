-- A transcript stamps the model on the reply, never on the prompt the reply answers, so
-- every prompt was stored with a null model. That made the model filter match no prompt at
-- all -- picking a model emptied every prompt-derived figure on every screen -- and left the
-- model breakdown blank. A prompt is attributed to the model that answered it.

-- Only unlinked prompts are indexed here, so it holds almost nothing once the backfill below
-- has run. It exists for the per-ingest linking that keeps new prompts attributed: without it
-- the planner walks every prompt in the session and the realtime watch pays 400ms a scan.
CREATE INDEX events_unlinked_prompt_idx ON events (session_id, timestamp)
  WHERE event_type = 'prompt' AND model IS NULL;

-- The first reply after the prompt, in the same session and on the same side of a subagent
-- boundary. `<synthetic>` is the placeholder Claude Code writes for its own generated
-- messages, so a reply carrying it is skipped in favour of the next real one. A prompt that
-- was never answered keeps its null rather than borrowing a model from somewhere else.
UPDATE events
   SET model = a.model, model_family = a.model_family
  FROM (
    SELECT p.id AS pid, r.model AS model, r.model_family AS model_family
      FROM events p
      JOIN events r ON r.id = (
        SELECT r2.id FROM events r2
         WHERE r2.session_id = p.session_id
           AND r2.is_subagent = p.is_subagent
           AND r2.event_type = 'response'
           AND r2.model IS NOT NULL
           AND r2.model NOT LIKE '<%'
           AND r2.timestamp >= p.timestamp
         ORDER BY r2.timestamp
         LIMIT 1)
     WHERE p.event_type = 'prompt' AND p.model IS NULL AND p.session_id IS NOT NULL
  ) AS a
 WHERE events.id = a.pid;

-- Prompts were rolled up under an empty model and are now rolled up under a real one, so the
-- derived tables no longer describe the event log. Emptying them makes the next start rebuild
-- them; the store repairs this invariant on boot rather than serving zeroes.
DELETE FROM daily_rollups;
DELETE FROM daily_active;
