/**
 * Real-mode polling (Phase 2). Sim mode doesn't use this — the time-warp
 * appends snapshots and settles as it advances the clock.
 *
 * Cadence per spec rule 8 (v2): scoring accrues continuously, so
 * - live pass (every 2h): snapshot EVERY track with a live pick, then settle
 *   — this is what makes portfolio points tick through the day.
 * - hourly pass: snapshot only "hot" tracks (a milestone crossed in the
 *   last 7 days), then settle.
 * Only ever polls tracks somebody picked, so call volume stays trivial.
 */

import type { FastifyBaseLogger } from "fastify";
import { getDb } from "../db/db.ts";
import { isRealTime } from "../sim/clock.ts";
import { activeProviderName, getActiveProvider } from "../providers/index.ts";
import { settleDay } from "./settle.ts";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const HOT_WINDOW_MS = 7 * DAY_MS;

interface TrackedRow {
  id: number;
  provider_track_id: string;
}

function liveTracks(): TrackedRow[] {
  return getDb()
    .prepare(
      `SELECT DISTINCT t.id, t.provider_track_id
         FROM tracks t JOIN picks p ON p.track_id = t.id
        WHERE t.provider = ? AND p.status = 'active'`,
    )
    .all(activeProviderName()) as unknown as TrackedRow[];
}

function hotTracks(): TrackedRow[] {
  const since = new Date(Date.now() - HOT_WINDOW_MS).toISOString();
  return getDb()
    .prepare(
      `SELECT DISTINCT t.id, t.provider_track_id
         FROM tracks t
         JOIN picks p ON p.track_id = t.id
         JOIN score_events e ON e.pick_id = p.id
        WHERE t.provider = ? AND p.status = 'active'
          AND e.type = 'milestone' AND e.computed_at >= ?`,
    )
    .all(activeProviderName(), since) as unknown as TrackedRow[];
}

async function pollAndSettle(rows: TrackedRow[], log: FastifyBaseLogger): Promise<void> {
  const db = getDb();
  const provider = getActiveProvider();
  const insert = db.prepare(
    "INSERT INTO track_snapshots (track_id, plays, likes, reposts, captured_at) VALUES (?, ?, ?, ?, ?)",
  );
  let ok = 0;
  for (const row of rows) {
    try {
      const stats = await provider.getTrackStats(row.provider_track_id);
      insert.run(row.id, stats.plays, stats.likes, stats.reposts, stats.fetchedAt);
      ok++;
    } catch (err) {
      log.warn(`poll failed for track ${row.provider_track_id}: ${(err as Error).message}`);
    }
  }
  db.prepare("UPDATE picks SET status = 'expired' WHERE status = 'active' AND expires_at < ?").run(
    new Date().toISOString(),
  );
  const settled = settleDay(0);
  log.info(
    `polled ${ok}/${rows.length} tracks; +${settled.eventsInserted} score events (${settled.pointsAwarded} pts)`,
  );
}

/** Start the recurring passes. Call once at boot; no-op in sim mode. */
export function startPollingJobs(log: FastifyBaseLogger): void {
  if (!isRealTime()) return;
  const livePass = () => pollAndSettle(liveTracks(), log).catch((e) => log.error(e));
  const hotPass = () => pollAndSettle(hotTracks(), log).catch((e) => log.error(e));
  livePass(); // catch up on whatever happened while the server was down
  setInterval(livePass, 2 * HOUR_MS).unref();
  setInterval(hotPass, HOUR_MS).unref();
  log.info("real-mode polling jobs started (all live picks every 2h, hot tracks hourly)");
}
