/**
 * Calibration corpus — a standing sample of real SoundCloud tracks, polled
 * daily to build the trajectory history that badge thresholds need.
 *
 * WHY THIS EXISTS
 * SoundCloud's API only ever returns a track's CURRENT play count. There is no
 * history endpoint, so trajectory shape (doublings, burst, sustain) cannot be
 * measured from a single call at any sample size. The only way to get it is to
 * start recording now. Sampling 1,450 live tracks showed the badge thresholds
 * tuned against the simulator are badly off — real tracks projected a maximum
 * of 2.78 doublings over 180 days, where Moonshot asks for 8 — but the sample
 * could only PROJECT from lifetime averages, not observe real curves.
 *
 * Lives in its own database file (firstfan-corpus.db) so it can grow large,
 * be rebuilt freely, and never lock or pollute the game's data.
 *
 *   npx tsx server/scripts/corpus.ts seed [n]    discover tracks (default 2000)
 *   npx tsx server/scripts/corpus.ts poll        snapshot every corpus track
 *   npx tsx server/scripts/corpus.ts report      calibration stats so far
 *
 * Schedule `poll` daily (Task Scheduler / cron). Batch fetching means the
 * whole corpus costs roughly (size / 50) calls per run.
 */

import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { classifyByAffinity, badgeName, trajectorySignals } from "../src/scoring/badges.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.CORPUS_DB ?? path.join(HERE, "..", "firstfan-corpus.db");
const BATCH = 50;
const PAUSE_MS = 250;

// ── env (BOM-tolerant; PowerShell's Set-Content writes one) ──
try {
  const raw = readFileSync(path.join(HERE, "..", ".env"), "utf8").replace(/^﻿/, "");
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m && !line.trimStart().startsWith("#") && process.env[m[1]!] === undefined) {
      process.env[m[1]!] = m[2]!.trim().replace(/^["'](.*)["']$/, "$1");
    }
  }
} catch { /* no .env — the commands below will explain */ }

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec(`
  CREATE TABLE IF NOT EXISTS corpus_tracks (
    provider_track_id TEXT PRIMARY KEY,
    title             TEXT NOT NULL,
    artist_name       TEXT,
    artist_id         TEXT,
    genre             TEXT,
    created_at        TEXT,
    discovered_at     TEXT NOT NULL,
    plays_at_discovery INTEGER,
    source            TEXT
  );
  CREATE TABLE IF NOT EXISTS corpus_snapshots (
    id                INTEGER PRIMARY KEY,
    provider_track_id TEXT NOT NULL REFERENCES corpus_tracks(provider_track_id),
    plays             INTEGER,
    likes             INTEGER,
    reposts           INTEGER,
    captured_at       TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_corpus_snap ON corpus_snapshots(provider_track_id, captured_at);
`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function token(): Promise<string> {
  const id = process.env.SOUNDCLOUD_CLIENT_ID;
  const secret = process.env.SOUNDCLOUD_CLIENT_SECRET;
  if (!id || !secret) throw new Error("server/.env needs SOUNDCLOUD_CLIENT_ID and _SECRET");
  const res = await fetch("https://secure.soundcloud.com/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`token exchange failed: HTTP ${res.status}`);
  return (await res.json()).access_token;
}

interface ScTrack {
  id: number; title: string; playback_count?: number; likes_count?: number;
  favoritings_count?: number; reposts_count?: number; genre?: string;
  created_at?: string; user?: { id: number; username?: string };
}

async function get<T>(url: string, tok: string): Promise<T | null> {
  const res = await fetch(url, { headers: { Authorization: `OAuth ${tok}`, Accept: "application/json" } });
  if (!res.ok) return null;
  return (await res.json()) as T;
}
const asList = (x: unknown): ScTrack[] =>
  Array.isArray(x) ? (x as ScTrack[]) : ((x as { collection?: ScTrack[] })?.collection ?? []);

/**
 * Discovery deliberately mixes two sources. Search alone returns popular
 * tracks — the wrong end of the market for a game about finding small
 * artists — so we also walk the CATALOGUES of artists we find, which is
 * where their small and new releases actually live.
 */
const GENRES = [
  "lofi", "hyperpop", "drill", "bedroom pop", "house", "ambient", "phonk", "indie rock",
  "jersey club", "shoegaze", "techno", "rap", "r&b", "jazz", "dnb", "uk garage", "emo",
  "trap", "afrobeats", "hardstyle", "soul", "punk", "synthwave", "country", "dubstep",
  "reggaeton", "hip hop", "electronic", "experimental", "folk",
];

async function seed(target: number): Promise<void> {
  const tok = await token();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO corpus_tracks
       (provider_track_id, title, artist_name, artist_id, genre, created_at,
        discovered_at, plays_at_discovery, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const now = new Date().toISOString();
  const artistIds = new Set<string>();
  let added = 0;

  const store = (t: ScTrack, source: string) => {
    if (typeof t.playback_count !== "number") return;
    const res = insert.run(
      String(t.id), t.title ?? "(untitled)", t.user?.username ?? null,
      t.user?.id != null ? String(t.user.id) : null, t.genre ?? null,
      t.created_at ?? null, now, t.playback_count, source,
    );
    if (res.changes > 0) added++;
    if (t.user?.id != null) artistIds.add(String(t.user.id));
  };

  console.log("discovering via genre search…");
  for (const g of GENRES) {
    if (added >= target) break;
    const list = asList(await get(`https://api.soundcloud.com/tracks?q=${encodeURIComponent(g)}&limit=50&access=playable`, tok));
    for (const t of list) store(t, `search:${g}`);
    process.stdout.write(`  ${g.padEnd(14)} corpus=${added}\r`);
    await sleep(PAUSE_MS);
  }
  console.log(`\nafter search: ${added} tracks, ${artistIds.size} distinct artists`);

  console.log("walking artist catalogues (this is where the small tracks are)…");
  for (const uid of artistIds) {
    if (added >= target) break;
    const list = asList(await get(`https://api.soundcloud.com/users/${uid}/tracks?limit=50`, tok));
    for (const t of list) store(t, "catalogue");
    process.stdout.write(`  corpus=${added}\r`);
    await sleep(PAUSE_MS);
  }

  const total = (db.prepare("SELECT COUNT(*) AS n FROM corpus_tracks").get() as { n: number }).n;
  const dist = db.prepare(
    `SELECT CASE WHEN plays_at_discovery < 1000 THEN 'a <1k'
                 WHEN plays_at_discovery < 10000 THEN 'b <10k'
                 WHEN plays_at_discovery < 100000 THEN 'c <100k'
                 WHEN plays_at_discovery < 1000000 THEN 'd <1M'
                 ELSE 'e 1M+' END AS band, COUNT(*) AS n
       FROM corpus_tracks GROUP BY band ORDER BY band`,
  ).all() as { band: string; n: number }[];
  console.log(`\ncorpus now ${total} tracks (+${added} this run)`);
  console.log("size mix at discovery:");
  for (const d of dist) console.log(`  ${d.band.slice(2).padEnd(7)} ${String(d.n).padStart(5)}`);
}

async function poll(): Promise<void> {
  const tok = await token();
  const ids = (db.prepare("SELECT provider_track_id FROM corpus_tracks").all() as { provider_track_id: string }[])
    .map((r) => r.provider_track_id);
  if (ids.length === 0) return console.log("corpus is empty — run `seed` first");

  const insert = db.prepare(
    "INSERT INTO corpus_snapshots (provider_track_id, plays, likes, reposts, captured_at) VALUES (?, ?, ?, ?, ?)",
  );
  const now = new Date().toISOString();
  let ok = 0, calls = 0;

  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const list = asList(await get(`https://api.soundcloud.com/tracks?ids=${chunk.join(",")}`, tok));
    calls++;
    for (const t of list) {
      insert.run(String(t.id), t.playback_count ?? null,
        t.favoritings_count ?? t.likes_count ?? null, t.reposts_count ?? null, now);
      ok++;
    }
    process.stdout.write(`  polled ${ok}/${ids.length} (${calls} calls)\r`);
    await sleep(PAUSE_MS);
  }
  console.log(`\nsnapshotted ${ok}/${ids.length} tracks in ${calls} API calls`);
}

/** What the corpus can tell us so far, using the REAL classifier. */
function report(): void {
  const tracks = db.prepare(
    `SELECT t.provider_track_id AS id, t.title, t.plays_at_discovery,
            COUNT(s.id) AS n, MIN(s.captured_at) AS first_at, MAX(s.captured_at) AS last_at
       FROM corpus_tracks t LEFT JOIN corpus_snapshots s ON s.provider_track_id = t.provider_track_id
      GROUP BY t.provider_track_id`,
  ).all() as { id: string; title: string; plays_at_discovery: number; n: number; first_at: string | null; last_at: string | null }[];

  const withHistory = tracks.filter((t) => t.n >= 2 && t.first_at && t.last_at);
  const spanDays = withHistory.length
    ? Math.max(...withHistory.map((t) => (Date.parse(t.last_at!) - Date.parse(t.first_at!)) / 86_400_000))
    : 0;

  console.log(`corpus:        ${tracks.length} tracks`);
  console.log(`with history:  ${withHistory.length} (>= 2 snapshots)`);
  console.log(`longest span:  ${spanDays.toFixed(1)} days\n`);

  if (spanDays < 1) {
    console.log("Not enough history yet to classify trajectories.");
    console.log("Run `poll` daily; useful signal starts around 14 days, real");
    console.log("calibration around 60-90. Nothing else substitutes for elapsed time.");
    return;
  }

  const snapsFor = db.prepare(
    "SELECT plays, captured_at AS capturedAt FROM corpus_snapshots WHERE provider_track_id = ? ORDER BY captured_at",
  );
  const counts = new Map<string, number>();
  const doublings: number[] = [];

  for (const t of withHistory) {
    const hist = snapsFor.all(t.id) as unknown as { plays: number | null; capturedAt: string }[];
    const baseline = hist.find((h) => h.plays !== null)?.plays;
    if (!baseline) continue;
    const s = trajectorySignals(baseline, t.first_at!, t.last_at!, hist);
    doublings.push(s.doublings);
    const c = classifyByAffinity(s);
    const label = badgeName(c.primary, c.secondary).label + (c.secondary ? " (hybrid)" : "");
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  doublings.sort((a, b) => a - b);
  const pct = (p: number) => doublings[Math.floor(doublings.length * p)] ?? 0;
  console.log("observed doublings over the window so far:");
  for (const p of [0.5, 0.9, 0.99]) console.log(`  p${Math.round(p * 100)}  ${pct(p).toFixed(3)}`);
  console.log(`  max  ${(doublings[doublings.length - 1] ?? 0).toFixed(3)}\n`);

  console.log("badge distribution (real classifier, real data):");
  for (const [label, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${label.padEnd(22)} ${String(n).padStart(5)}  ${((n / withHistory.length) * 100).toFixed(1)}%`);
  }
  console.log(
    `\nNOTE: a ${spanDays.toFixed(0)}-day window understates every trajectory —` +
    `\nthresholds are written for 180 days. Compare shapes, not absolutes, until the span matches.`,
  );
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "seed") await seed(Number(arg) || 2000);
else if (cmd === "poll") await poll();
else if (cmd === "report") report();
else console.log("usage: corpus.ts seed [n] | poll | report");
db.close();
