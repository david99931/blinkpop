-- v2.0 scoring: continuous growth accrual. score_events gains the 'growth'
-- type (weekly_growth stays legal for legacy rows; the engine no longer
-- emits it). SQLite CHECK constraints require a table rebuild.

CREATE TABLE score_events_new (
  id              INTEGER PRIMARY KEY,
  pick_id         INTEGER NOT NULL REFERENCES picks(id),
  type            TEXT NOT NULL CHECK (type IN ('milestone', 'weekly_growth', 'early_bird', 'growth')),
  milestone_value INTEGER,
  points          REAL NOT NULL,
  computed_at     TEXT NOT NULL,
  dedupe_key      TEXT NOT NULL UNIQUE
);
INSERT INTO score_events_new SELECT * FROM score_events;
DROP TABLE score_events;
ALTER TABLE score_events_new RENAME TO score_events;
CREATE INDEX idx_score_events_pick ON score_events(pick_id);
