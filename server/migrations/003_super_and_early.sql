-- v1.2: weekly super pick + early-bird bonus.
--
-- picks: add kind ('daily'|'super') and pick_week; the one-per-day rule now
-- applies to DAILY picks only (partial unique index), and one super pick is
-- allowed per user-local ISO week. SQLite can't alter table constraints, so
-- rebuild. Rename-before-drop keeps foreign keys satisfied mid-transaction.

CREATE TABLE picks_new (
  id                   INTEGER PRIMARY KEY,
  user_id              INTEGER NOT NULL REFERENCES users(id),
  track_id             INTEGER NOT NULL REFERENCES tracks(id),
  picked_at            TEXT NOT NULL,
  pick_date            TEXT NOT NULL,
  pick_week            TEXT NOT NULL,
  kind                 TEXT NOT NULL DEFAULT 'daily' CHECK (kind IN ('daily', 'super')),
  baseline_snapshot_id INTEGER NOT NULL REFERENCES track_snapshots(id),
  pick_rank            INTEGER NOT NULL,
  artist_avg_plays     INTEGER,
  expires_at           TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired')),
  -- Game rule 3 (never the same track twice) spans daily AND super picks.
  UNIQUE (user_id, track_id)
);

-- Legacy rows are all daily picks; %W-week is a placeholder (real ISO weeks
-- are computed in JS at pick time and only matter for super picks).
INSERT INTO picks_new (id, user_id, track_id, picked_at, pick_date, pick_week, kind,
                       baseline_snapshot_id, pick_rank, artist_avg_plays, expires_at, status)
  SELECT id, user_id, track_id, picked_at, pick_date,
         strftime('%Y-W%W', pick_date), 'daily',
         baseline_snapshot_id, pick_rank, artist_avg_plays, expires_at, status
    FROM picks;

ALTER TABLE picks RENAME TO picks_old;
ALTER TABLE picks_new RENAME TO picks;

-- score_events: allow the new 'early_bird' event type (CHECK rebuild).
CREATE TABLE score_events_new (
  id              INTEGER PRIMARY KEY,
  pick_id         INTEGER NOT NULL REFERENCES picks(id),
  type            TEXT NOT NULL CHECK (type IN ('milestone', 'weekly_growth', 'early_bird')),
  milestone_value INTEGER,
  points          REAL NOT NULL,
  computed_at     TEXT NOT NULL,
  dedupe_key      TEXT NOT NULL UNIQUE
);
INSERT INTO score_events_new SELECT * FROM score_events;
DROP TABLE score_events;
DROP TABLE picks_old;
ALTER TABLE score_events_new RENAME TO score_events;

CREATE UNIQUE INDEX uq_picks_daily ON picks(user_id, pick_date) WHERE kind = 'daily';
CREATE UNIQUE INDEX uq_picks_super_week ON picks(user_id, pick_week) WHERE kind = 'super';
CREATE INDEX idx_picks_track ON picks(track_id);
CREATE INDEX idx_picks_user ON picks(user_id);
CREATE INDEX idx_score_events_pick ON score_events(pick_id);
