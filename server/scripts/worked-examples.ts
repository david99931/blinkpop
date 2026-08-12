/**
 * Dump a full classification trace for real and simulated runs.
 *
 * Every number a worked example needs — the five signals, all five affinity
 * scores, the ranking, purity, the verdict and the points — computed by the
 * REAL classifier so documentation can't drift from behaviour.
 *
 *   npm run examples
 */

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  affinities, badgeName, blendedScore, classifyByAffinity, trajectorySignals,
  type SignalInput,
} from "../src/scoring/badges.ts";
import type { Badge } from "@firstfan/shared";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.join(HERE, "..", "firstfan-corpus.db");
const SIM = path.join(HERE, "..", "firstfan.db");

function realPoints(json: any): SignalInput[] {
  const o = json && typeof json === "object" && "obj" in json ? json.obj : json;
  const block = Array.isArray(o) ? o[0] : o;
  return (block?.data ?? [])
    .filter((p: any) => p && p.interpolated !== true && p.value != null && (p.timestp ?? p.timestamp))
    .map((p: any) => ({ plays: Number(p.value), capturedAt: String(p.timestp ?? p.timestamp) }))
    .sort((a: SignalInput, b: SignalInput) => a.capturedAt.localeCompare(b.capturedAt));
}

function trace(label: string, pts: SignalInput[], rank = 1, kind: "daily" | "super" = "daily") {
  if (pts.length < 2) return null;
  const base = pts[0]!.plays!;
  const s = trajectorySignals(base, pts[0]!.capturedAt, pts[pts.length - 1]!.capturedAt, pts);
  const a = affinities(s);
  const c = classifyByAffinity(s);
  const name = badgeName(c.primary, c.secondary);
  const pts_ = blendedScore(c, s, { artistAvgPlays: base, pickRank: rank, kind });
  const ranked = (Object.entries(a) as [Badge, number][]).sort((x, y) => y[1] - x[1]);

  console.log(`\n${"─".repeat(72)}\n${label}`);
  console.log(`  ${base.toLocaleString()} → ${s.finalPlays.toLocaleString()}  over ${pts.length} points`);
  console.log(`  signals: gained ${Math.round(s.gained).toLocaleString()} · doublings ${s.doublings.toFixed(2)} · ` +
    `peak ${s.peak.toFixed(2)} · sustain ${s.sustain.toFixed(2)} · burstShare ${s.burstShare.toFixed(3)}`);
  console.log(`  affinities: ${ranked.map(([b, v]) => `${b} ${v.toFixed(3)}`).join(" · ")}`);
  console.log(`  purity ${c.purity === Infinity ? "∞" : c.purity.toFixed(2)} → ` +
    `${c.secondary ? `HYBRID ${name.label}` : `PURE ${name.label}`}   points ${pts_.toFixed(0)}`);
  return { label, s, a, c, name, points: pts_, ranked };
}

// ── real: cached Chartmetric Spotify series ──
console.log(`${"=".repeat(72)}\nREAL DATA — Spotify, 180 days, interpolated points removed\n${"=".repeat(72)}`);
const corpus = new DatabaseSync(CORPUS);
const rows = corpus
  .prepare("SELECT cm_track_id, payload FROM cm_history WHERE platform = 'spotify'")
  .all() as unknown as { cm_track_id: number; payload: string }[];

const traced = rows
  .map((r) => ({ id: r.cm_track_id, pts: realPoints(JSON.parse(r.payload)) }))
  .filter((x) => x.pts.length >= 2)
  .map((x) => {
    const base = x.pts[0]!.plays!;
    const s = trajectorySignals(base, x.pts[0]!.capturedAt, x.pts[x.pts.length - 1]!.capturedAt, x.pts);
    return { ...x, s, c: classifyByAffinity(s) };
  });

// One clean representative per badge, plus the most extreme hybrid.
const seen = new Set<string>();
for (const t of traced.sort((a, b) => b.s.doublings - a.s.doublings)) {
  const key = `${t.c.primary}|${t.c.secondary ?? ""}`;
  if (seen.has(key)) continue;
  seen.add(key);
  trace(`cm#${t.id}`, t.pts);
}

// ── fake: sim world picks ──
console.log(`\n\n${"=".repeat(72)}\nSIMULATED DATA — sim world picks (6 snapshots/day)\n${"=".repeat(72)}`);
try {
  const sim = new DatabaseSync(SIM);
  const picks = sim
    .prepare(
      `SELECT p.id, p.track_id, p.picked_at, p.expires_at, p.pick_rank, p.kind,
              base.plays AS baseline_plays, t.title
         FROM picks p
         JOIN track_snapshots base ON base.id = p.baseline_snapshot_id
         JOIN tracks t ON t.id = p.track_id`,
    )
    .all() as unknown as any[];
  const snapsFor = sim.prepare(
    "SELECT plays, captured_at AS capturedAt FROM track_snapshots WHERE track_id = ? ORDER BY captured_at",
  );
  const simSeen = new Set<string>();
  for (const p of picks) {
    if (p.baseline_plays === null) continue;
    const all = snapsFor.all(p.track_id) as unknown as SignalInput[];
    const win = all.filter((x) => x.capturedAt >= p.picked_at && x.capturedAt <= p.expires_at);
    if (win.length < 2) continue;
    const s = trajectorySignals(p.baseline_plays, p.picked_at, p.expires_at, all);
    const c = classifyByAffinity(s);
    const key = `${c.primary}|${c.secondary ?? ""}`;
    if (simSeen.has(key)) continue;
    simSeen.add(key);
    trace(`"${p.title.slice(0, 40)}"  rank ${p.pick_rank} ${p.kind}`,
      [{ plays: p.baseline_plays, capturedAt: p.picked_at }, ...win], p.pick_rank, p.kind);
  }
} catch (e) {
  console.log(`(sim world unavailable: ${(e as Error).message})`);
}
