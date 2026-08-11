-- v4: badges. A pick is classified by the SHAPE of its track's run and scored
-- by that badge's own formula, so scores are comparable within a badge rather
-- than across the whole game.
--
-- ARCHITECTURAL SHIFT: badge_points is a DERIVED value recomputed from full
-- snapshot history each settlement, not an append-only ledger. The per-badge
-- formulas are whole-trajectory functions (peak burst, sustain), so there is
-- nothing to accrue incrementally. Idempotency is trivial instead of earned:
-- the same history always produces the same verdict.
--
-- score_events therefore stops being a ledger and becomes a MOMENT log —
-- "crossed 100k", "upgraded to Moonshot" — for the feed and inbox. Its points
-- column is no longer summed anywhere and is written as 0.

ALTER TABLE picks ADD COLUMN badge TEXT NOT NULL DEFAULT 'flatline';
ALTER TABLE picks ADD COLUMN badge_points REAL NOT NULL DEFAULT 0;
ALTER TABLE picks ADD COLUMN badge_at TEXT;

CREATE INDEX idx_picks_badge ON picks(badge, badge_points);

-- Growth events were the old ledger's bulk; the badge score subsumes them.
DELETE FROM score_events WHERE type = 'growth';

-- Allow the new 'badge' moment type.
CREATE TABLE score_events_new (
  id              INTEGER PRIMARY KEY,
  pick_id         INTEGER NOT NULL REFERENCES picks(id),
  type            TEXT NOT NULL CHECK (type IN ('milestone', 'weekly_growth', 'early_bird', 'growth', 'stall', 'badge')),
  milestone_value INTEGER,
  points          REAL NOT NULL,
  computed_at     TEXT NOT NULL,
  dedupe_key      TEXT NOT NULL UNIQUE
);
INSERT INTO score_events_new SELECT * FROM score_events;
DROP TABLE score_events;
ALTER TABLE score_events_new RENAME TO score_events;
CREATE INDEX idx_score_events_pick ON score_events(pick_id);
