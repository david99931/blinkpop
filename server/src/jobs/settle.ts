/**
 * Settlement: run the pure scoring engine over every pick and persist any
 * NEW score events. Idempotent by construction — events insert with
 * `INSERT OR IGNORE` on the UNIQUE dedupe_key, so re-running settlement
 * (or recomputing history from scratch) can never double-award.
 *
 * Cadence (spec rule 8): in Phase 1 sim-time, the time-warp calls this once
 * per simulated day, which also covers the weekly bonus (the engine emits a
 * week's event as soon as a snapshot at/after the week's end exists).
 * Phase 2 real-time wiring: daily batch for all live picks + hourly pass for
 * "hot" tracks — cadence should be a config value per track tier.
 */

import { inTransaction } from "../db/db.ts";
import { scorePick, type SnapshotPoint } from "../scoring/engine.ts";

export interface SettleResult {
  picksExamined: number;
  eventsInserted: number;
  pointsAwarded: number;
}

interface SettlePickRow {
  id: number;
  user_id: number;
  track_id: number;
  picked_at: string;
  pick_rank: number;
  expires_at: string;
  kind: "daily" | "super";
  artist_avg_plays: number | null;
  baseline_plays: number | null;
  title: string;
  artist_name: string;
}

export function settleDay(_simDayIndex: number): SettleResult {
  return inTransaction((db) => {
    // Expired picks are included: a crossing that happened before expiry may
    // not have been settled yet; the engine caps everything at expires_at.
    const picks = db
      .prepare(
        `SELECT p.id, p.user_id, p.track_id, p.picked_at, p.pick_rank, p.expires_at, p.kind,
                p.artist_avg_plays, base.plays AS baseline_plays, t.title, t.artist_name
           FROM picks p
           JOIN track_snapshots base ON base.id = p.baseline_snapshot_id
           JOIN tracks t ON t.id = p.track_id`,
      )
      .all() as unknown as SettlePickRow[];

    const snapshotsFor = db.prepare(
      "SELECT plays, captured_at AS capturedAt FROM track_snapshots WHERE track_id = ? ORDER BY captured_at",
    );
    const insertEvent = db.prepare(
      "INSERT OR IGNORE INTO score_events (pick_id, type, milestone_value, points, computed_at, dedupe_key) " +
        "VALUES (?, ?, ?, ?, ?, ?)",
    );
    const insertNotification = db.prepare(
      "INSERT INTO notifications (user_id, type, payload, created_at) VALUES (?, ?, ?, ?)",
    );

    let eventsInserted = 0;
    let pointsAwarded = 0;

    for (const p of picks) {
      const history = snapshotsFor.all(p.track_id) as unknown as SnapshotPoint[];
      const drafts = scorePick(
        {
          pickId: p.id,
          baselinePlays: p.baseline_plays,
          artistAvgPlays: p.artist_avg_plays,
          pickRank: p.pick_rank,
          kind: p.kind,
          pickedAt: p.picked_at,
          expiresAt: p.expires_at,
        },
        history,
      );
      for (const d of drafts) {
        const res = insertEvent.run(
          d.pickId,
          d.type,
          d.milestoneValue,
          d.points,
          d.occurredAt,
          d.dedupeKey,
        );
        if (res.changes > 0) {
          eventsInserted++;
          pointsAwarded += d.points;
          // Growth accrues every couple of hours — points move silently;
          // notifications are reserved for milestone/early-bird moments.
          if (d.type === "growth") continue;
          insertNotification.run(
            p.user_id,
            d.type === "milestone"
              ? "milestone_crossed"
              : d.type === "weekly_growth"
                ? "weekly_growth_awarded"
                : "early_bird_awarded",
            JSON.stringify({
              pickId: p.id,
              trackId: p.track_id,
              title: p.title,
              artistName: p.artist_name,
              milestoneValue: d.milestoneValue,
              points: d.points,
            }),
            d.occurredAt,
          );
        }
      }
    }

    return { picksExamined: picks.length, eventsInserted, pointsAwarded };
  });
}
