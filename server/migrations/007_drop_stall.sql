-- v2.2: stall decay is gone. Picks no longer LOSE points — instead growth
-- only accrues while a track is at or above its tier's ideal curve.
-- Purge the negative events and their notifications so historical totals
-- match the current rules.

DELETE FROM score_events WHERE type = 'stall';
DELETE FROM notifications WHERE type = 'pick_stalling';
