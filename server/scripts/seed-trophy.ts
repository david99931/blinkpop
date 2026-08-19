/**
 * Build a demo account whose trophy case is full — several picks of every badge.
 *
 * The badges are NOT written directly. Trajectories are generated over a
 * parameter grid, classified by the REAL classifier, and only then kept, so
 * what you see is genuinely what the live scoring produces. If a badge turns
 * out to be unreachable, this script reports it rather than faking it — which
 * makes it a calibration check as much as a fixture.
 *
 *   npm run seed:trophy            # user @trophy, password demo1234
 *   npm run seed:trophy 4          # 4 picks per badge
 */

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BADGE_ORDER, PICK_WINDOW_DAYS, type Badge } from "@firstfan/shared";
import { classifyByAffinity, badgeName, trajectorySignals, type SignalInput } from "../src/scoring/badges.ts";
import { hashPassword } from "../src/domain/auth.ts";
import { isoWeekOf } from "../src/domain/picks.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH =
  process.env.FIRSTFAN_DB ??
  path.join(HERE, "..", process.env.FIRSTFAN_PROVIDER === "soundcloud" ? "firstfan-live.db" : "firstfan.db");
const DAY = 86_400_000;
const HANDLE = "trophy";
const PER_BADGE = Math.max(1, Math.min(8, Number(process.argv[2]) || 3));

// ── trajectory generation ────────────────────────────────────────────────
// A candidate is a baseline, a total multiple, and a shape describing WHEN the
// gain lands. Shape is what separates the archetypes: the same 10× ends up a
// Riser, a Breakout or a Bolt depending purely on its distribution over time.

type Shape = "steady" | "spike-early" | "spike-mid" | "spike-late" | "late-run" | "stairs"
  | "steady-bump" | "steady-surge" | "steady-flare" | "coarse-stairs";

/** Cumulative fraction of the total gain realised by day t of n. */
function curve(shape: Shape, t: number, n: number): number {
  const x = t / n;
  switch (shape) {
    case "steady":
      return (Math.exp(3 * x) - 1) / (Math.E ** 3 - 1);
    case "spike-early":
      return x < 0.1 ? x * 0.4 : Math.min(1, 0.04 + 0.92 * Math.min(1, (x - 0.1) / 0.05) + 0.04 * x);
    case "spike-mid":
      return x < 0.45 ? x * 0.09 : Math.min(1, 0.04 + 0.92 * Math.min(1, (x - 0.45) / 0.05) + 0.04 * x);
    case "spike-late":
      return x < 0.8 ? x * 0.06 : Math.min(1, 0.05 + 0.95 * Math.min(1, (x - 0.8) / 0.05));
    case "late-run":
      return x < 0.5 ? x * 0.1 : 0.05 + 0.95 * ((x - 0.5) / 0.5) ** 1.6;
    case "stairs": {
      // growth only on ~1 day in 3 — drags `sustain` down without changing total
      const steps = Math.floor(x * 12) / 12;
      return steps;
    }
    // steady climb PLUS one notable week — the only way to hold a high sustain
    // and a high burstShare at once, which is what a Riser/Breakout hybrid needs
    case "steady-bump": {
      const base = x * 0.55;
      const bump = x < 0.6 ? 0 : Math.min(0.45, 0.45 * ((x - 0.6) / 0.06));
      return Math.min(1, base + bump);
    }
    // Same idea as steady-bump but with the week carrying more of the total.
    // Second Wind needs sustain AND burstShare high at once: even growth
    // everywhere keeps sustain up, while one dominant week lifts burstShare
    // past the breakout floor.
    case "steady-surge": {
      const base = x * 0.35;
      const bump = x < 0.55 ? 0 : Math.min(0.65, 0.65 * ((x - 0.55) / 0.05));
      return Math.min(1, base + bump);
    }
    case "steady-flare": {
      const base = x * 0.25;
      const bump = x < 0.5 ? 0 : Math.min(0.75, 0.75 * ((x - 0.5) / 0.04));
      return Math.min(1, base + bump);
    }
    // very few, very large steps — pushes sustain near the floor
    case "coarse-stairs":
      return Math.floor(x * 4) / 4;
  }
}

function series(baseline: number, multiple: number, shape: Shape, days: number, startMs: number): SignalInput[] {
  const total = Math.max(0, Math.round(baseline * (multiple - 1)));
  const out: SignalInput[] = [];
  for (let t = 0; t <= days; t++) {
    const plays = Math.round(baseline + total * Math.min(1, Math.max(0, curve(shape, t, days))));
    out.push({ plays, capturedAt: new Date(startMs + t * DAY).toISOString() });
  }
  return out;
}

const BASELINES = [400, 2_000, 12_000, 80_000, 400_000, 2_500_000, 20_000_000];
const MULTIPLES = [
  1.01, 1.06, 1.18, 1.3, 1.6, 1.9, 2.02, 2.09, 2.14, 2.2, 2.4, 2.8,
  3.6, 4.5, 6, 8, 11, 16, 26, 45, 70, 130, 200, 400, 700, 1400, 2400,
];
const SHAPES: Shape[] = [
  "steady", "spike-early", "spike-mid", "spike-late", "late-run", "stairs",
  "steady-bump", "steady-surge", "steady-flare", "coarse-stairs",
];

interface Candidate {
  key: string; label: string; primary: Badge; second: Badge | null;
  baseline: number; multiple: number; shape: Shape; purity: number;
}

/** Search the grid, classify with the live classifier, bucket by badge. */
function findCandidates(): Map<string, Candidate[]> {
  const buckets = new Map<string, Candidate[]>();
  const start = Date.now() - (PICK_WINDOW_DAYS + 30) * DAY;
  for (const baseline of BASELINES) {
    for (const multiple of MULTIPLES) {
      for (const shape of SHAPES) {
        const pts = series(baseline, multiple, shape, PICK_WINDOW_DAYS, start);
        const s = trajectorySignals(
          baseline,
          pts[0]!.capturedAt,
          pts[pts.length - 1]!.capturedAt,
          pts,
        );
        const c = classifyByAffinity(s);
        const key = c.secondary ? [c.primary, c.secondary].sort().join("|") : c.primary;
        const list = buckets.get(key) ?? [];
        list.push({
          key, label: badgeName(c.primary, c.secondary).label,
          primary: c.primary, second: c.secondary,
          baseline, multiple, shape, purity: c.purity,
        });
        buckets.set(key, list);
      }
    }
  }
  return buckets;
}

/** Every badge the game defines, so we can report which ones the grid missed. */
function allKeys(): string[] {
  const keys: string[] = [...BADGE_ORDER];
  for (let i = 0; i < BADGE_ORDER.length; i++) {
    for (let j = i + 1; j < BADGE_ORDER.length; j++) {
      keys.push([BADGE_ORDER[i]!, BADGE_ORDER[j]!].sort().join("|"));
    }
  }
  return keys;
}

// ── seeding ──────────────────────────────────────────────────────────────
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA foreign_keys = ON;");

const buckets = findCandidates();
const keys = allKeys();

console.log(`grid: ${BASELINES.length * MULTIPLES.length * SHAPES.length} trajectories classified\n`);

const now = Date.now();
const existing = db.prepare("SELECT id FROM users WHERE handle = ?").get(HANDLE) as { id: number } | undefined;
if (existing) {
  // Idempotent: wipe the previous trophy user so re-running is safe.
  db.exec("BEGIN");
  db.prepare("DELETE FROM score_events WHERE pick_id IN (SELECT id FROM picks WHERE user_id = ?)").run(existing.id);
  db.prepare("DELETE FROM notifications WHERE user_id = ?").run(existing.id);
  db.prepare("DELETE FROM picks WHERE user_id = ?").run(existing.id);
  db.prepare("DELETE FROM streaks WHERE user_id = ?").run(existing.id);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(existing.id);
  db.prepare("DELETE FROM users WHERE id = ?").run(existing.id);
  db.exec("COMMIT");
  console.log("removed previous @trophy account");
}

// Unconditional, and AFTER the user delete: a run that failed part-way leaves
// orphan tracks with no user attached, and gating this on the user existing
// would strand them behind the unique index forever.
db.exec("BEGIN");
db.prepare(
  "DELETE FROM picks WHERE track_id IN (SELECT id FROM tracks WHERE provider_track_id LIKE 'trophy-%')",
).run();
db.prepare(
  "DELETE FROM track_snapshots WHERE track_id IN " +
    "(SELECT id FROM tracks WHERE provider_track_id LIKE 'trophy-%')",
).run();
db.prepare("DELETE FROM tracks WHERE provider_track_id LIKE 'trophy-%'").run();
db.exec("COMMIT");

db.exec("BEGIN");
const userId = Number(
  (db
    .prepare(
      "INSERT INTO users (handle, display_name, email, tz, created_at, password_hash) VALUES (?,?,?,?,?,?) RETURNING id",
    )
    .get(HANDLE, "Trophy Case", "trophy@demo.local", "UTC", new Date(now - 400 * DAY).toISOString(), hashPassword("demo1234")) as { id: number }).id,
);

const insTrack = db.prepare(
  "INSERT INTO tracks (provider, provider_track_id, title, artist_name, first_seen_at) VALUES (?,?,?,?,?) RETURNING id",
);
const insSnap = db.prepare(
  "INSERT INTO track_snapshots (track_id, plays, likes, reposts, captured_at) VALUES (?,?,?,?,?) RETURNING id",
);
const insPick = db.prepare(
  `INSERT INTO picks (user_id, track_id, picked_at, pick_date, pick_week, kind, baseline_snapshot_id,
                      pick_rank, expires_at, status, artist_avg_plays, badge, badge_second,
                      badge_purity, badge_points, badge_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
);

let dayCursor = 0;
let made = 0;
const missing: string[] = [];
const summary: string[] = [];

for (const key of keys) {
  const pool = (buckets.get(key) ?? []).slice();
  if (!pool.length) { missing.push(key); continue; }
  // Prefer the most decisive examples — highest purity for pure badges, and
  // for hybrids the ones sitting furthest from the threshold either way.
  pool.sort((a, b) => b.purity - a.purity);
  const chosen: Candidate[] = [];
  for (let i = 0; i < PER_BADGE; i++) chosen.push(pool[Math.floor((i * pool.length) / PER_BADGE)]!);

  for (const cand of chosen) {
    dayCursor++;
    // Each pick's whole 180-day window sits in the past, so every trajectory
    // is complete and the badge is final.
    const pickedMs = now - (PICK_WINDOW_DAYS + 25 + dayCursor) * DAY;
    const pts = series(cand.baseline, cand.multiple, cand.shape, PICK_WINDOW_DAYS, pickedMs);
    const trackId = Number(
      (insTrack.get(
        "mock",
        `trophy-${dayCursor}`,
        `${cand.label} #${dayCursor} · ${cand.shape}`,
        `Demo Artist ${String.fromCharCode(65 + (dayCursor % 26))}`,
        new Date(pickedMs).toISOString(),
      ) as { id: number }).id,
    );

    let baselineSnapId = 0;
    for (const p of pts) {
      const id = Number(
        (insSnap.get(trackId, p.plays, Math.round((p.plays ?? 0) / 40), Math.round((p.plays ?? 0) / 200), p.capturedAt) as { id: number }).id,
      );
      if (!baselineSnapId) baselineSnapId = id;
    }

    const pickDate = new Date(pickedMs).toISOString().slice(0, 10);
    insPick.run(
      userId, trackId,
      new Date(pickedMs).toISOString(),
      pickDate,
      isoWeekOf(pickDate),
      "daily",
      baselineSnapId, 1,
      new Date(pickedMs + PICK_WINDOW_DAYS * DAY).toISOString(),
      "expired",
      cand.baseline, // artist average ≈ baseline, so the underdog tier is sane
      "flatline", null, null, 0, null,
    );
    made++;
    summary.push(
      `  ${cand.label.padEnd(13)} base ${String(cand.baseline).padStart(9)} × ${String(cand.multiple).padStart(6)}  ${cand.shape}`,
    );
  }
}

db.prepare("INSERT INTO streaks (user_id, current_streak, longest_streak, last_pick_date) VALUES (?,?,?,?)")
  .run(userId, 0, made, new Date(now).toISOString().slice(0, 10));
db.exec("COMMIT");
db.close();

console.log(summary.join("\n"));
console.log(`\ncreated @${HANDLE} (password demo1234) with ${made} picks across ${keys.length - missing.length}/${keys.length} badges`);
if (missing.length) {
  console.log(`\n⚠ NOT REACHABLE from this parameter grid: ${missing.join(", ")}`);
  console.log("  Either the grid is too coarse, or the badge is genuinely very hard to earn.");
}
console.log("\nRun settlement to classify them:  curl -X POST http://127.0.0.1:3001/api/dev/resettle");
