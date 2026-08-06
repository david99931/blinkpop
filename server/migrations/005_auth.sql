-- Real auth (replaces the x-user-id dev header) + provider account linking.

-- NULL password_hash = legacy local account (created before auth existed);
-- the first successful login claims it by setting the password.
ALTER TABLE users ADD COLUMN password_hash TEXT;

-- Bearer sessions; the raw token never touches the DB (sha256 stored).
CREATE TABLE sessions (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Linked music-platform accounts (OAuth user tokens) — powers listening
-- stats / suggestions features. One link per provider per user.
CREATE TABLE connected_accounts (
  user_id          INTEGER NOT NULL REFERENCES users(id),
  provider         TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  display_name     TEXT,
  access_token     TEXT NOT NULL,
  refresh_token    TEXT,
  token_expires_at TEXT,
  connected_at     TEXT NOT NULL,
  PRIMARY KEY (user_id, provider)
);
