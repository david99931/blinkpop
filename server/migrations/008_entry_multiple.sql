-- v3: the per-tier growth "bar" is gone; every score event is now scaled by
-- the entry multiple (doublings since the pick's baseline) at the moment it
-- was earned.
--
-- Settlement inserts with INSERT OR IGNORE keyed on dedupe_key, so it will
-- NOT restate rows that already exist — a rules change has to clear them.
-- Deleting is safe: scorePick() rebuilds the full history from snapshots on
-- the next settlement pass (POST /api/dev/resettle, or the next poll/warp).

DELETE FROM score_events;
