/**
 * The simulated clock. In Phase 1 EVERY timestamp the game writes (picks,
 * snapshots, score events) must come from simNow(), never new Date() —
 * otherwise time-warp breaks. Phase 2 swaps this for real time.
 */

import { getDb } from "../db/db.ts";

export const DAY_MS = 86_400_000;
/** Day 0 of the simulated universe. */
export const SIM_EPOCH = Date.parse("2026-08-01T00:00:00.000Z");
/** Snapshots are stamped at midday so they sort clearly within a day. */
export const SNAPSHOT_HOUR_MS = 12 * 3_600_000;

export function simDay(): number {
  const db = getDb();
  const row = db.prepare("SELECT value FROM app_state WHERE key = 'sim_day'").get() as
    | { value: string }
    | undefined;
  if (!row) {
    db.prepare("INSERT INTO app_state (key, value) VALUES ('sim_day', '0')").run();
    return 0;
  }
  return Number(row.value);
}

export function setSimDay(day: number): void {
  getDb()
    .prepare(
      "INSERT INTO app_state (key, value) VALUES ('sim_day', ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(String(day));
}

/** Current sim time: midday of the current sim day. */
export function simNow(): Date {
  return new Date(SIM_EPOCH + simDay() * DAY_MS + SNAPSHOT_HOUR_MS);
}

export function simTimeForDay(day: number): Date {
  return new Date(SIM_EPOCH + day * DAY_MS + SNAPSHOT_HOUR_MS);
}
