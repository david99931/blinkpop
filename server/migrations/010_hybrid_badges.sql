-- v5: hybrid badges. Classification now scores a run against EVERY archetype
-- and decides pure-vs-hybrid by how decisively the leader wins, instead of
-- first-match-wins (which never measured a Juggernaut-qualifying run against
-- Moonshot at all).
--
-- badge          stays the PRIMARY archetype and remains upgrade-only, so
--                existing per-badge leaderboards keep working unchanged.
-- badge_second   the other half of a hybrid; NULL means a pure badge.
-- badge_purity   topAffinity / secondAffinity, kept for display and tuning.

ALTER TABLE picks ADD COLUMN badge_second TEXT;
ALTER TABLE picks ADD COLUMN badge_purity REAL;
