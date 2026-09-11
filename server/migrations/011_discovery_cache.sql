-- Discovery candidates, cached per (user, reach).
--
-- A full run makes ~57 SoundCloud calls and takes 20-30s, which is far too slow
-- to sit in front of a page load. Results are computed once and served from
-- here; a refresh is an explicit action rather than something a page visit
-- silently triggers.
CREATE TABLE discovery_runs (
  user_id     INTEGER NOT NULL REFERENCES users(id),
  reach       TEXT NOT NULL,
  computed_at TEXT NOT NULL,
  band_min    INTEGER NOT NULL,
  band_max    INTEGER NOT NULL,
  api_calls   INTEGER NOT NULL,
  PRIMARY KEY (user_id, reach)
);

CREATE TABLE discovery_candidates (
  user_id           INTEGER NOT NULL REFERENCES users(id),
  reach             TEXT NOT NULL,
  provider_track_id TEXT NOT NULL,
  title             TEXT NOT NULL,
  artist_name       TEXT NOT NULL,
  plays             INTEGER NOT NULL,
  likes             INTEGER NOT NULL,
  genre             TEXT,
  permalink_url     TEXT,
  artwork_url       TEXT,
  created_at        TEXT,
  -- How we found it: catalogue:X / search:X / new:X. Kept because provenance
  -- is what tells us which pass is actually earning its API calls.
  via               TEXT NOT NULL,
  -- Smoothed likes-per-play; see discovery.ts for why the raw ratio is unusable.
  score             REAL NOT NULL,
  PRIMARY KEY (user_id, reach, provider_track_id)
);
CREATE INDEX idx_disc_rank ON discovery_candidates(user_id, reach, score DESC);
