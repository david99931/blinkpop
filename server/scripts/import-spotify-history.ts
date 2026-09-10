/**
 * Import a Spotify extended streaming history export.
 *
 * This is the deep version of "what does this person actually listen to" — the
 * Web API only exposes a top-50 ranking and the last 50 plays, with no play
 * counts and no listening time anywhere. The export has every stream since the
 * account was created, each with a timestamp and ms_played.
 *
 * PRIVACY — the file carries far more than we want:
 *   ip_addr, conn_country, platform, incognito_mode, offline_timestamp
 * Those are read and THROWN AWAY. Only timestamp, track, artist, album, uri and
 * ms_played are ever written. See KEEP/DISCARD below — the discard list is
 * explicit so it stays a deliberate decision rather than an oversight.
 *
 * Rows are AGGREGATED on import rather than stored raw: a decade of listening
 * is ~100MB of JSON but only a few tens of thousands of distinct tracks, and
 * nothing we want to show needs an individual play row.
 *
 *   npm run spotify:import <dir-of-json> [userId]
 */

import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.SPOTIFY_HISTORY_DB ?? path.join(HERE, "..", "firstfan-spotify.db");

/** Fields we keep. Everything else in the export is discarded on read. */
interface Play {
  ts: string;
  ms_played: number;
  master_metadata_track_name: string | null;
  master_metadata_album_artist_name: string | null;
  master_metadata_album_album_name: string | null;
  spotify_track_uri: string | null;
}

/**
 * Never written to disk. Listed by name so that if Spotify adds a field, the
 * default is to ignore it rather than silently persist something personal.
 */
const DISCARDED_FIELDS = [
  "ip_addr", "conn_country", "platform", "incognito_mode",
  "offline", "offline_timestamp", "user_agent_decrypted",
  "reason_start", "reason_end", "shuffle", "skipped",
] as const;

/** A play shorter than this is a skip, not a listen. */
const MIN_MS = 30_000;

const dir = process.argv[2];
const userId = Number(process.argv[3] || 1);
if (!dir) {
  console.log("usage: spotify:import <dir-containing-Streaming_History_Audio_*.json> [userId]");
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec(`
  CREATE TABLE IF NOT EXISTS spotify_track_history (
    user_id      INTEGER NOT NULL,
    track_uri    TEXT NOT NULL,
    track_name   TEXT,
    artist_name  TEXT,
    album_name   TEXT,
    first_played TEXT NOT NULL,
    last_played  TEXT NOT NULL,
    play_count   INTEGER NOT NULL,
    ms_played    INTEGER NOT NULL,
    PRIMARY KEY (user_id, track_uri)
  );
  CREATE TABLE IF NOT EXISTS spotify_artist_history (
    user_id      INTEGER NOT NULL,
    artist_name  TEXT NOT NULL,
    first_played TEXT NOT NULL,
    last_played  TEXT NOT NULL,
    play_count   INTEGER NOT NULL,
    ms_played    INTEGER NOT NULL,
    track_count  INTEGER NOT NULL,
    PRIMARY KEY (user_id, artist_name)
  );
  CREATE TABLE IF NOT EXISTS spotify_import (
    user_id     INTEGER PRIMARY KEY,
    imported_at TEXT NOT NULL,
    files       INTEGER NOT NULL,
    rows_read   INTEGER NOT NULL,
    rows_kept   INTEGER NOT NULL,
    span_start  TEXT,
    span_end    TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sp_first ON spotify_track_history(user_id, first_played);
  CREATE INDEX IF NOT EXISTS idx_sp_ms ON spotify_artist_history(user_id, ms_played DESC);
`);

interface Agg {
  trackName: string | null; artistName: string | null; albumName: string | null;
  first: string; last: string; count: number; ms: number;
}

const tracks = new Map<string, Agg>();
const artists = new Map<string, { first: string; last: string; count: number; ms: number; uris: Set<string> }>();

const files = readdirSync(dir).filter((f) => /^Streaming_History_Audio_.*\.json$/i.test(f)).sort();
if (!files.length) {
  console.log(`no Streaming_History_Audio_*.json in ${dir}`);
  process.exit(1);
}

let rowsRead = 0, rowsKept = 0, skipped = 0, nonMusic = 0;
let spanStart: string | null = null, spanEnd: string | null = null;

for (const file of files) {
  const raw = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as Play[];
  rowsRead += raw.length;

  for (const p of raw) {
    // Podcasts and audiobooks have no track uri — this is a music game.
    if (!p.spotify_track_uri) { nonMusic++; continue; }
    if ((p.ms_played ?? 0) < MIN_MS) { skipped++; continue; }

    const ts = p.ts;
    const uri = p.spotify_track_uri;
    const artist = p.master_metadata_album_artist_name;

    if (!spanStart || ts < spanStart) spanStart = ts;
    if (!spanEnd || ts > spanEnd) spanEnd = ts;

    const t = tracks.get(uri);
    if (!t) {
      tracks.set(uri, {
        trackName: p.master_metadata_track_name,
        artistName: artist,
        albumName: p.master_metadata_album_album_name,
        first: ts, last: ts, count: 1, ms: p.ms_played,
      });
    } else {
      if (ts < t.first) t.first = ts;
      if (ts > t.last) t.last = ts;
      t.count++;
      t.ms += p.ms_played;
    }

    if (artist) {
      const a = artists.get(artist);
      if (!a) artists.set(artist, { first: ts, last: ts, count: 1, ms: p.ms_played, uris: new Set([uri]) });
      else {
        if (ts < a.first) a.first = ts;
        if (ts > a.last) a.last = ts;
        a.count++; a.ms += p.ms_played; a.uris.add(uri);
      }
    }
    rowsKept++;
  }
  process.stdout.write(`  ${file} — ${raw.length} rows\n`);
}

db.exec("BEGIN");
db.prepare("DELETE FROM spotify_track_history WHERE user_id = ?").run(userId);
db.prepare("DELETE FROM spotify_artist_history WHERE user_id = ?").run(userId);
const insT = db.prepare(
  "INSERT INTO spotify_track_history VALUES (?,?,?,?,?,?,?,?,?)",
);
for (const [uri, t] of tracks) {
  insT.run(userId, uri, t.trackName, t.artistName, t.albumName, t.first, t.last, t.count, Math.round(t.ms));
}
const insA = db.prepare("INSERT INTO spotify_artist_history VALUES (?,?,?,?,?,?,?)");
for (const [name, a] of artists) {
  insA.run(userId, name, a.first, a.last, a.count, Math.round(a.ms), a.uris.size);
}
db.prepare(
  "INSERT INTO spotify_import VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET " +
    "imported_at=excluded.imported_at, files=excluded.files, rows_read=excluded.rows_read, " +
    "rows_kept=excluded.rows_kept, span_start=excluded.span_start, span_end=excluded.span_end",
).run(userId, new Date().toISOString(), files.length, rowsRead, rowsKept, spanStart, spanEnd);
db.exec("COMMIT");

const hours = [...tracks.values()].reduce((s, t) => s + t.ms, 0) / 3_600_000;
console.log(`\n${"=".repeat(62)}`);
console.log(`imported for user ${userId}`);
console.log(`${"=".repeat(62)}`);
console.log(`  files            ${files.length}`);
console.log(`  rows read        ${rowsRead.toLocaleString()}`);
console.log(`  kept             ${rowsKept.toLocaleString()}  (>=${MIN_MS / 1000}s of music)`);
console.log(`  skipped <30s     ${skipped.toLocaleString()}`);
console.log(`  non-music        ${nonMusic.toLocaleString()}  (podcasts / audiobooks)`);
console.log(`  distinct tracks  ${tracks.size.toLocaleString()}`);
console.log(`  distinct artists ${artists.size.toLocaleString()}`);
console.log(`  listening time   ${Math.round(hours).toLocaleString()} hours  (${(hours / 24).toFixed(0)} days)`);
console.log(`  span             ${spanStart?.slice(0, 10)} → ${spanEnd?.slice(0, 10)}`);
console.log(`  discarded fields ${DISCARDED_FIELDS.join(", ")}`);
db.close();
