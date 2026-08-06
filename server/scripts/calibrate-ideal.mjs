/**
 * Calibrate the per-tier ideal growth curves from observed data.
 * Run:  node server/scripts/calibrate-ideal.mjs [path/to/firstfan.db]
 *
 * For every track that has snapshot history, computes the realised
 * compound daily growth rate, buckets tracks by their artist tier, and
 * reports the MEDIAN rate per tier. The median (not the mean) is the number
 * to use: a handful of moonshots would drag a mean far above what a typical
 * track in the tier actually does, making the benchmark unbeatable.
 *
 * Paste the results into UNDERDOG_TIERS[].idealDailyGrowth in
 * shared/src/scoring-config.ts.
 */

import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const dbPath = process.argv[2] ?? path.join(import.meta.dirname, "..", "firstfan.db");
const db = new DatabaseSync(dbPath);

const TIERS = [
  { max: 1_000, label: "artist <1k" },
  { max: 10_000, label: "artist <10k" },
  { max: 50_000, label: "artist <50k" },
  { max: 250_000, label: "artist <250k" },
  { max: 1_000_000, label: "artist <1M" },
  { max: Infinity, label: "artist 1M+" },
];
const tierFor = (plays) => TIERS.find((t) => plays < t.max) ?? TIERS[TIERS.length - 1];

const tracks = db
  .prepare(
    `SELECT t.id, t.title, t.artist_name,
            (SELECT plays FROM track_snapshots s WHERE s.track_id = t.id AND s.plays IS NOT NULL
              ORDER BY s.captured_at LIMIT 1) AS first_plays,
            (SELECT captured_at FROM track_snapshots s WHERE s.track_id = t.id AND s.plays IS NOT NULL
              ORDER BY s.captured_at LIMIT 1) AS first_at,
            (SELECT plays FROM track_snapshots s WHERE s.track_id = t.id AND s.plays IS NOT NULL
              ORDER BY s.captured_at DESC LIMIT 1) AS last_plays,
            (SELECT captured_at FROM track_snapshots s WHERE s.track_id = t.id AND s.plays IS NOT NULL
              ORDER BY s.captured_at DESC LIMIT 1) AS last_at
       FROM tracks t`,
  )
  .all();

const buckets = new Map(TIERS.map((t) => [t.label, []]));
let used = 0;

for (const t of tracks) {
  if (t.first_plays == null || t.last_plays == null || t.first_plays <= 0) continue;
  const days = (Date.parse(t.last_at) - Date.parse(t.first_at)) / 86_400_000;
  if (days < 7) continue; // too little history to say anything
  const rate = Math.pow(t.last_plays / t.first_plays, 1 / days) - 1;
  buckets.get(tierFor(t.first_plays).label).push(rate);
  used++;
}

const median = (xs) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

console.log(`Observed growth from ${used} tracks with ≥7 days of history (${dbPath})\n`);
console.log("tier            n     median/day   suggested idealDailyGrowth");
for (const t of TIERS) {
  const xs = buckets.get(t.label);
  const m = median(xs);
  const p75 = xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.75)] : null;
  console.log(
    `${t.label.padEnd(15)} ${String(xs.length).padEnd(5)} ` +
      `${m === null ? "—" : (m * 100).toFixed(2) + "%"}`.padEnd(13) +
      `${m === null ? "—" : m.toFixed(4)}` +
      (p75 !== null ? `   (p75 ${(p75 * 100).toFixed(2)}%)` : ""),
  );
}
console.log(
  "\nUse the median: a benchmark set at the mean would sit above most tracks in the tier\n" +
    "and almost nothing would ever earn.",
);
