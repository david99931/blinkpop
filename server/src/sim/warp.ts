/**
 * Time-warp (dev-only): advance the sim clock N days. For each day advanced,
 * append a snapshot for every track the domain knows about (only tracks
 * someone has picked/viewed exist in `tracks` — spec §5: only picked tracks
 * get polled), then run settlement for that day.
 */

import { getDb, inTransaction } from "../db/db.ts";
import { getUniverse } from "./catalog.ts";
import { isRealTime, setSimDay, simDay, simTimeForDay } from "./clock.ts";
import { settleDay } from "../jobs/settle.ts";

export interface WarpResult {
  fromDay: number;
  toDay: number;
  daysAdvanced: number;
  snapshotsInserted: number;
}

export function warp(days: number): WarpResult {
  if (isRealTime()) {
    throw new Error("Time-warp is sim-only — the app is running against the real provider");
  }
  if (!Number.isInteger(days) || days < 1 || days > 400) {
    throw new Error("days must be an integer between 1 and 400");
  }
  const fromDay = simDay();
  const universe = getUniverse();
  let snapshotsInserted = 0;

  for (let day = fromDay + 1; day <= fromDay + days; day++) {
    inTransaction((db) => {
      const tracked = db
        .prepare("SELECT id, provider_track_id FROM tracks WHERE provider = 'mock'")
        .all() as { id: number; provider_track_id: string }[];
      const insert = db.prepare(
        "INSERT INTO track_snapshots (track_id, plays, likes, reposts, captured_at) VALUES (?, ?, ?, ?, ?)",
      );
      const capturedAt = simTimeForDay(day).toISOString();
      for (const t of tracked) {
        const sim = universe.get(t.provider_track_id);
        if (!sim) continue; // track from another seed's universe; leave it be
        const s = sim.statsAt(day);
        insert.run(t.id, s.plays, s.likes, s.reposts, capturedAt);
        snapshotsInserted++;
      }
      // Scoring window (game rule 6): picks stop accruing after 180 days.
      db.prepare("UPDATE picks SET status = 'expired' WHERE status = 'active' AND expires_at < ?").run(
        capturedAt,
      );
      setSimDay(day);
    });
    settleDay(day);
  }

  return { fromDay, toDay: fromDay + days, daysAdvanced: days, snapshotsInserted };
}
