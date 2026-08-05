/**
 * The game clock. Sim mode (mock provider): every timestamp the game writes
 * (picks, snapshots, score events) comes from the warp-driven sim clock.
 * Real mode (FIRSTFAN_PROVIDER=soundcloud): simNow() is simply real time and
 * the warp/simDay machinery is off-limits (guarded at the callers).
 */

import { getDb } from "../db/db.ts";

/** Read directly from env (not providers/) to avoid an import cycle. */
export function isRealTime(): boolean {
  return process.env.FIRSTFAN_PROVIDER === "soundcloud";
}

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

/** Current game time: real time in real mode, else midday of the sim day. */
export function simNow(): Date {
  if (isRealTime()) return new Date();
  return new Date(SIM_EPOCH + simDay() * DAY_MS + SNAPSHOT_HOUR_MS);
}

export function simTimeForDay(day: number): Date {
  return new Date(SIM_EPOCH + day * DAY_MS + SNAPSHOT_HOUR_MS);
}
