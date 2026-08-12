/**
 * Read-only blast-radius check for making `sustain` cadence-invariant.
 *
 * Nothing is written and no production code is touched. Every pick in the sim
 * world is classified twice — once with today's snapshot-counting sustain, once
 * with a day-grouped sustain — and the two verdicts are diffed.
 *
 * The point is NOT the sustain number itself. Classification is a ranking and
 * purity is a ratio (top ÷ second), so perturbing one affinity can reshuffle
 * which badge wins and whether a pick reads pure or hybrid. That knock-on is
 * the thing worth measuring before changing anything.
 *
 *   npm run sustain:diff
 */

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  blendedScore,
  classifyByAffinity,
  badgeName,
  trajectorySignals,
  type SignalInput,
  type TrajectorySignals,
} from "../src/scoring/badges.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.FIRSTFAN_DB ?? path.join(HERE, "..", "firstfan.db");
const DAY_MS = 86_400_000;

/**
 * Proposed replacement: fraction of DAYS carrying meaningful growth, rather
 * than fraction of snapshots. Identical on daily data; on the sim's 6/day it
 * stops splitting one day's growth across six slots and failing most of them.
 */
function daySustain(
  baselinePlays: number,
  pickedAt: string,
  expiresAt: string,
  history: readonly SignalInput[],
): number {
  const pickedMs = Date.parse(pickedAt);
  const expiresMs = Date.parse(expiresAt);
  const snaps = history
    .filter((s) => s.plays !== null)
    .map((s) => ({ plays: s.plays!, ms: Date.parse(s.capturedAt) }))
    .filter((s) => s.ms >= pickedMs && s.ms <= expiresMs)
    .sort((a, b) => a.ms - b.ms);
  if (!snaps.length) return 0;

  let prev = baselinePlays;
  const perDay = new Map<number, number>();
  for (const s of snaps) {
    const delta = Math.max(0, s.plays - prev);
    prev = s.plays;
    const day = Math.floor(s.ms / DAY_MS);
    perDay.set(day, (perDay.get(day) ?? 0) + delta);
  }

  const days = [...perDay.values()];
  const gained = Math.max(0, snaps[snaps.length - 1]!.plays - baselinePlays);
  const meaningful = (gained / Math.max(1, days.length)) * 0.25;
  const active = days.filter((d) => d > Math.max(1, meaningful)).length;
  return days.length ? active / days.length : 0;
}

interface PickRow {
  id: number; track_id: number; picked_at: string; expires_at: string;
  pick_rank: number; kind: "daily" | "super"; artist_avg_plays: number | null;
  baseline_plays: number | null; title: string;
}

const db = new DatabaseSync(DB_PATH);
const picks = db
  .prepare(
    `SELECT p.id, p.track_id, p.picked_at, p.expires_at, p.pick_rank, p.kind,
            p.artist_avg_plays, base.plays AS baseline_plays, t.title
       FROM picks p
       JOIN track_snapshots base ON base.id = p.baseline_snapshot_id
       JOIN tracks t ON t.id = p.track_id`,
  )
  .all() as unknown as PickRow[];
const snapsFor = db.prepare(
  "SELECT plays, captured_at AS capturedAt FROM track_snapshots WHERE track_id = ? ORDER BY captured_at",
);

let examined = 0;
let badgeChanged = 0, pureToHybrid = 0, hybridToPure = 0, hybridRenamed = 0;
const sustainOld: number[] = [], sustainNew: number[] = [], pointsDelta: number[] = [];
const examples: string[] = [];

for (const p of picks) {
  if (p.baseline_plays === null) continue;
  const history = snapsFor.all(p.track_id) as unknown as SignalInput[];
  const before = trajectorySignals(p.baseline_plays, p.picked_at, p.expires_at, history);
  const after: TrajectorySignals = {
    ...before,
    sustain: daySustain(p.baseline_plays, p.picked_at, p.expires_at, history),
  };
  examined++;
  sustainOld.push(before.sustain);
  sustainNew.push(after.sustain);

  const c1 = classifyByAffinity(before);
  const c2 = classifyByAffinity(after);
  const scoreIn = { artistAvgPlays: p.artist_avg_plays, pickRank: p.pick_rank, kind: p.kind };
  const pts1 = blendedScore(c1, before, scoreIn);
  const pts2 = blendedScore(c2, after, scoreIn);
  if (pts1 > 0) pointsDelta.push((pts2 - pts1) / pts1);

  const n1 = badgeName(c1.primary, c1.secondary);
  const n2 = badgeName(c2.primary, c2.secondary);
  const wasPure = c1.secondary === null, isPure = c2.secondary === null;

  if (c1.primary !== c2.primary) badgeChanged++;
  else if (wasPure && !isPure) pureToHybrid++;
  else if (!wasPure && isPure) hybridToPure++;
  else if (n1.label !== n2.label) hybridRenamed++;
  else continue;

  if (examples.length < 12) {
    examples.push(
      `  ${p.title.slice(0, 34).padEnd(34)} ${n1.label.padEnd(12)} → ${n2.label.padEnd(12)}` +
        `  sustain ${before.sustain.toFixed(2)}→${after.sustain.toFixed(2)}` +
        `  purity ${c1.purity === Infinity ? "∞" : c1.purity.toFixed(2)}→${c2.purity === Infinity ? "∞" : c2.purity.toFixed(2)}` +
        `  pts ${pts1 > 0 ? (((pts2 - pts1) / pts1) * 100).toFixed(0) + "%" : "—"}`,
    );
  }
}

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const med = (v: number[]) => {
  const s = v.slice().sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};

console.log(`${"=".repeat(70)}\nSUSTAIN CHANGE — BLAST RADIUS ON THE SIM WORLD\n${"=".repeat(70)}`);
console.log(`picks examined: ${examined}\n`);
console.log(`sustain value   mean ${mean(sustainOld).toFixed(3)} → ${mean(sustainNew).toFixed(3)}   ` +
  `median ${med(sustainOld).toFixed(3)} → ${med(sustainNew).toFixed(3)}`);
console.log(`riser points    median change ${(med(pointsDelta) * 100).toFixed(1)}%   ` +
  `mean ${(mean(pointsDelta) * 100).toFixed(1)}%\n`);

const changed = badgeChanged + pureToHybrid + hybridToPure + hybridRenamed;
console.log(`picks whose DISPLAYED badge changes: ${changed} of ${examined}` +
  ` (${examined ? ((changed / examined) * 100).toFixed(1) : "0"}%)`);
console.log(`  primary badge changed : ${badgeChanged}`);
console.log(`  pure → hybrid         : ${pureToHybrid}`);
console.log(`  hybrid → pure         : ${hybridToPure}`);
console.log(`  hybrid renamed        : ${hybridRenamed}`);
if (examples.length) {
  console.log(`\nexamples:`);
  for (const e of examples) console.log(e);
}
console.log(
  `\nNote: existing picks are protected in settlement — higherBadge() never\n` +
    `moves a badge down BADGE_ORDER and sticky-purity preserves an earned pure.\n` +
    `The counts above are how FUTURE classification would differ.`,
);
