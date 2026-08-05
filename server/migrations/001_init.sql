-- First Fan — initial schema (spec §7), SQLite dialect.
-- Timestamps are ISO-8601 UTC strings; pick_date is the user-LOCAL calendar date.

CREATE TABLE users (
  id           INTEGER PRIMARY KEY,
  handle       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  email        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  tz           TEXT NOT NULL DEFAULT 'UTC',
  created_at   TEXT NOT NULL
);

CREATE TABLE follows (
  follower_id INTEGER NOT NULL REFERENCES users(id),
  followee_id INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);

CREATE TABLE tracks (
  id                INTEGER PRIMARY KEY,
  provider          TEXT NOT NULL,
  provider_track_id TEXT NOT NULL,
  title             TEXT NOT NULL,
  artist_name       TEXT NOT NULL,
  artwork_url       TEXT,
  permalink_url     TEXT,
  first_seen_at     TEXT NOT NULL,
  UNIQUE (provider, provider_track_id)
);

-- Append-only time series. plays/likes/reposts are nullable: a provider can
-- have stats disabled for a track; such picks are excluded from scoring
-- until stats exist.
CREATE TABLE track_snapshots (
  id          INTEGER PRIMARY KEY,
  track_id    INTEGER NOT NULL REFERENCES tracks(id),
  plays       INTEGER,
  likes       INTEGER,
  reposts     INTEGER,
  captured_at TEXT NOT NULL
);
CREATE INDEX idx_snapshots_track_time ON track_snapshots(track_id, captured_at);

CREATE TABLE picks (
  id                   INTEGER PRIMARY KEY,
  user_id              INTEGER NOT NULL REFERENCES users(id),
  track_id             INTEGER NOT NULL REFERENCES tracks(id),
  picked_at            TEXT NOT NULL,
  pick_date            TEXT NOT NULL,
  baseline_snapshot_id INTEGER NOT NULL REFERENCES track_snapshots(id),
  -- 1 = first picker of this track, ever. Assigned inside the pick
  -- transaction to prevent race-condition ties (spec §10).
  pick_rank            INTEGER NOT NULL,
  expires_at           TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired')),
  -- Game rule 3: never the same track twice per user (lifetime).
  UNIQUE (user_id, track_id),
  -- Game rule 1: one pick per user-local day.
  UNIQUE (user_id, pick_date)
);
CREATE INDEX idx_picks_track ON picks(track_id);
CREATE INDEX idx_picks_user ON picks(user_id);

CREATE TABLE score_events (
  id              INTEGER PRIMARY KEY,
  pick_id         INTEGER NOT NULL REFERENCES picks(id),
  type            TEXT NOT NULL CHECK (type IN ('milestone', 'weekly_growth')),
  milestone_value INTEGER,
  points          REAL NOT NULL,
  computed_at     TEXT NOT NULL,
  -- e.g. 'pick:42:milestone:100000' — makes settlement idempotent: re-running
  -- the batch job can never double-award.
  dedupe_key      TEXT NOT NULL UNIQUE
);
CREATE INDEX idx_score_events_pick ON score_events(pick_id);

CREATE TABLE streaks (
  user_id        INTEGER PRIMARY KEY REFERENCES users(id),
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  last_pick_date TEXT
);

CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  type       TEXT NOT NULL,
  payload    TEXT NOT NULL, -- JSON
  created_at TEXT NOT NULL,
  read_at    TEXT
);
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at);

-- Small key/value store for app state; Phase 1 uses it for the simulator's
-- current clock ('sim_clock' → ISO timestamp).
CREATE TABLE app_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
