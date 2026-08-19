/**
 * Settlement (v4): classify every live pick by its track's trajectory, upgrade
 * its badge if the run earned a better one, and store the score under that
 * badge's own formula.
 *
 * badge_points is DERIVED — recomputed from the full snapshot history every
 * pass — because the per-badge formulas are whole-trajectory functions (peak
 * burst, sustain) with nothing to accrue incrementally. That makes idempotency
 * structural: the same history always yields the same verdict, so re-running
 * settlement can't drift.
 *
 * score_events is now a MOMENT log for the feed and inbox — milestone
 * crossings, early-bird payouts, badge upgrades — deduped by `dedupe_key` so
 * a moment is announced exactly once. Its points column is not summed
 * anywhere; the pick's badge_points is the only score.
 */

import { MILESTONES, earlyBirdTierFor } from "@firstfan/shared";
import type { Badge } from "@firstfan/shared";
import { inTransaction } from "../db/db.ts";
import { badgeName, evaluatePick, higherBadge, type SignalInput } from "../scoring/badges.ts";

export interface SettleResult {
  picksExamined: number;
  badgesUpgraded: number;
  momentsLogged: number;
}

interface SettlePickRow {
  id: number;
  user_id: number;
  track_id: number;
  picked_at: string;
  expires_at: string;
  pick_rank: number;
  kind: "daily" | "super";
  artist_avg_plays: number | null;
  baseline_plays: number | null;
  badge: Badge;
  badge_second: Badge | null;
  badge_purity: number | null;
  /** null until the pick has been classified once — see the wasPure guard. */
  badge_at: string | null;
  title: string;
  artist_name: string;
}

export function settleDay(_simDayIndex: number): SettleResult {
  return inTransaction((db) => {
    const picks = db
      .prepare(
        `SELECT p.id, p.user_id, p.track_id, p.picked_at, p.expires_at, p.pick_rank, p.kind,
                p.artist_avg_plays, p.badge, p.badge_second, p.badge_purity, p.badge_at,
                base.plays AS baseline_plays, t.title, t.artist_name
           FROM picks p
           JOIN track_snapshots base ON base.id = p.baseline_snapshot_id
           JOIN tracks t ON t.id = p.track_id`,
      )
      .all() as unknown as SettlePickRow[];

    const snapshotsFor = db.prepare(
      "SELECT plays, captured_at AS capturedAt FROM track_snapshots WHERE track_id = ? ORDER BY captured_at",
    );
    const updatePick = db.prepare(
      "UPDATE picks SET badge = ?, badge_second = ?, badge_purity = ?, badge_points = ?, " +
        "badge_at = COALESCE(badge_at, ?) WHERE id = ?",
    );
    const bumpBadgeAt = db.prepare("UPDATE picks SET badge_at = ? WHERE id = ?");
    const insertMoment = db.prepare(
      "INSERT OR IGNORE INTO score_events (pick_id, type, milestone_value, points, computed_at, dedupe_key) " +
        "VALUES (?, ?, ?, 0, ?, ?)",
    );
    const insertNotification = db.prepare(
      "INSERT INTO notifications (user_id, type, payload, created_at) VALUES (?, ?, ?, ?)",
    );

    let badgesUpgraded = 0;
    let momentsLogged = 0;

    for (const p of picks) {
      const history = snapshotsFor.all(p.track_id) as unknown as SignalInput[];
      const verdict = evaluatePick(p.baseline_plays, p.picked_at, p.expires_at, history, {
        artistAvgPlays: p.artist_avg_plays,
        pickRank: p.pick_rank,
        kind: p.kind,
      });
      if (!verdict) continue;

      const badge = higherBadge(p.badge, verdict.badge);
      // Purity is an upgrade too: once a run has earned a PURE badge at this
      // primary it never reverts to a hybrid, same principle as the badge.
      //
      // `badge_at !== null` is load-bearing. The badge column DEFAULTS to
      // 'flatline' with a null secondary, so without this check a pick being
      // classified for the FIRST time as a flatline-primary hybrid looks
      // identical to one that had already earned a pure Flatline — and the
      // secondary was stripped and locked. That made Bolt unearnable outright
      // and quietly degraded Ember and One Hit whenever flatline led.
      const wasPure = p.badge_at !== null && p.badge === badge && p.badge_second === null;
      const secondary = wasPure ? null : badge === verdict.badge ? verdict.secondary : p.badge_second;
      // Keep the purity that JUSTIFIED the locked badge rather than the live
      // value — otherwise a pick reads "pure" beside a sub-threshold number.
      const purity = wasPure && p.badge_purity !== null ? p.badge_purity : verdict.purity;
      const points = verdict.points;

      const now = new Date().toISOString();
      updatePick.run(badge, secondary, purity, points, now, p.id);

      if (badge !== p.badge) {
        badgesUpgraded++;
        bumpBadgeAt.run(now, p.id);
        const named = badgeName(badge, secondary);
        const res = insertMoment.run(p.id, "badge", null, now, `pick:${p.id}:badge:${badge}`);
        if (res.changes > 0) {
          momentsLogged++;
          insertNotification.run(
            p.user_id,
            "badge_upgraded",
            JSON.stringify({
              pickId: p.id, trackId: p.track_id, title: p.title, artistName: p.artist_name,
              badge, badgeLabel: named.label, icon: named.icon,
            }),
            now,
          );
        }
      }

      // ── Moments for the feed: milestone crossings and the early-bird payout.
      const B = p.baseline_plays!;
      const inWindow = history
        .filter((s) => s.plays !== null)
        .filter((s) => s.capturedAt >= p.picked_at && s.capturedAt <= p.expires_at);
      let firstCrossing: SignalInput | null = null;
      for (const m of MILESTONES) {
        if (B >= m.plays) continue;
        const crossing = inWindow.find((s) => s.plays! >= m.plays);
        if (!crossing) continue;
        if (!firstCrossing) firstCrossing = crossing;
        const res = insertMoment.run(
          p.id, "milestone", m.plays, crossing.capturedAt, `pick:${p.id}:milestone:${m.plays}`,
        );
        if (res.changes > 0) {
          momentsLogged++;
          insertNotification.run(
            p.user_id,
            "milestone_crossed",
            JSON.stringify({
              pickId: p.id, trackId: p.track_id, title: p.title,
              artistName: p.artist_name, milestoneValue: m.plays,
            }),
            crossing.capturedAt,
          );
        }
      }

      if (earlyBirdTierFor(B) && firstCrossing) {
        const res = insertMoment.run(
          p.id, "early_bird", null, firstCrossing.capturedAt, `pick:${p.id}:early_bird`,
        );
        if (res.changes > 0) {
          momentsLogged++;
          insertNotification.run(
            p.user_id,
            "early_bird_awarded",
            JSON.stringify({
              pickId: p.id, trackId: p.track_id, title: p.title, artistName: p.artist_name,
            }),
            firstCrossing.capturedAt,
          );
        }
      }
    }

    return { picksExamined: picks.length, badgesUpgraded, momentsLogged };
  });
}
