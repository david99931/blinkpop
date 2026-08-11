import { PICK_WINDOW_DAYS, underdogTierFor, type Pick, type PickKind } from "@firstfan/shared";
import type { DatabaseSync } from "node:sqlite";
import { getDb, inTransaction } from "../db/db.ts";
import { DAY_MS, simNow } from "../sim/clock.ts";
import { getActiveProvider } from "../providers/index.ts";
import { DomainError, getUserById } from "./users.ts";

/** User-local calendar date (YYYY-MM-DD) for a moment in time. */
export function localDate(at: Date, tz: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function previousDate(dateStr: string): string {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
}

/** ISO-8601 week (Monday-start) of a local date, e.g. "2026-W32". */
export function isoWeekOf(dateStr: string): string {
  const d = new Date(Date.parse(`${dateStr}T00:00:00Z`));
  const day = (d.getUTCDay() + 6) % 7; // Mon = 0
  d.setUTCDate(d.getUTCDate() - day + 3); // the week's Thursday decides the ISO year
  const isoYear = d.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

interface PickRow {
  id: number;
  user_id: number;
  track_id: number;
  picked_at: string;
  pick_date: string;
  pick_week: string;
  kind: PickKind;
  baseline_snapshot_id: number;
  pick_rank: number;
  expires_at: string;
  status: "active" | "expired";
  badge: import("@firstfan/shared").Badge;
  badge_points: number;
  badge_at: string | null;
}

function toPick(r: PickRow): Pick {
  return {
    id: r.id,
    userId: r.user_id,
    trackId: r.track_id,
    pickedAt: r.picked_at,
    pickDate: r.pick_date,
    pickWeek: r.pick_week,
    kind: r.kind,
    baselineSnapshotId: r.baseline_snapshot_id,
    pickRank: r.pick_rank,
    expiresAt: r.expires_at,
    status: r.status,
    badge: r.badge ?? "flatline",
    badgePoints: r.badge_points ?? 0,
    badgeAt: r.badge_at ?? null,
  };
}

function updateStreak(db: DatabaseSync, userId: number, pickDate: string): void {
  const row = db.prepare("SELECT * FROM streaks WHERE user_id = ?").get(userId) as
    | { current_streak: number; longest_streak: number; last_pick_date: string | null }
    | undefined;
  if (row?.last_pick_date === pickDate) return; // second pick today (super) — streak already counted
  const continues = row?.last_pick_date === previousDate(pickDate);
  const current = continues ? row!.current_streak + 1 : 1;
  const longest = Math.max(current, row?.longest_streak ?? 0);
  db.prepare(
    "INSERT INTO streaks (user_id, current_streak, longest_streak, last_pick_date) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(user_id) DO UPDATE SET current_streak = ?, longest_streak = ?, last_pick_date = ?",
  ).run(userId, current, longest, pickDate, current, longest, pickDate);
}

function notifyFollowers(db: DatabaseSync, userId: number, payload: object, at: string): void {
  const followers = db
    .prepare("SELECT follower_id FROM follows WHERE followee_id = ?")
    .all(userId) as { follower_id: number }[];
  const insert = db.prepare(
    "INSERT INTO notifications (user_id, type, payload, created_at) VALUES (?, 'followed_user_picked', ?, ?)",
  );
  for (const f of followers) insert.run(f.follower_id, JSON.stringify(payload), at);
}

/**
 * Confirm a pick: the immutable moment the game is built around.
 * One transaction does: upsert track → baseline snapshot → pick_rank
 * assignment → pick insert (DB UNIQUE constraints enforce the game rules)
 * → streak update → follower notifications. No update/delete path exists.
 *
 * kind "super": the weekly 5× pick — an extra slot that doesn't consume the
 * daily pick; one per user-local ISO week (partial unique index enforces it).
 */
export async function makePick(
  userId: number,
  providerTrackId: string,
  kind: PickKind = "daily",
): Promise<Pick> {
  const user = getUserById(userId);
  if (!user) throw new DomainError("unknown_user", "User not found");

  const provider = getActiveProvider();
  let details;
  try {
    details = await provider.getTrack(providerTrackId);
  } catch {
    throw new DomainError("track_not_found", `No such track: ${providerTrackId}`);
  }

  const now = simNow();
  const nowIso = now.toISOString();
  const pickDate = localDate(now, user.tz);
  const pickWeek = isoWeekOf(pickDate);
  const expiresAt = new Date(now.getTime() + PICK_WINDOW_DAYS * DAY_MS).toISOString();

  return inTransaction((db) => {
    let trackId: number;
    const existing = db
      .prepare("SELECT id FROM tracks WHERE provider = ? AND provider_track_id = ?")
      .get(details.provider, details.providerTrackId) as { id: number } | undefined;
    if (existing) {
      trackId = existing.id;
    } else {
      const res = db
        .prepare(
          "INSERT INTO tracks (provider, provider_track_id, title, artist_name, artwork_url, permalink_url, first_seen_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          details.provider,
          details.providerTrackId,
          details.title,
          details.artistName,
          details.artworkUrl,
          details.permalinkUrl,
          nowIso,
        );
      trackId = Number(res.lastInsertRowid);
    }

    const snapRes = db
      .prepare(
        "INSERT INTO track_snapshots (track_id, plays, likes, reposts, captured_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(trackId, details.stats.plays, details.stats.likes, details.stats.reposts, nowIso);
    const baselineSnapshotId = Number(snapRes.lastInsertRowid);

    // Assigned inside the transaction — two simultaneous pickers can't tie
    // (spec §10). SQLite's single-writer model guarantees this; on Postgres
    // this needs SELECT ... FOR UPDATE or a serializable transaction.
    const rankRow = db
      .prepare("SELECT COUNT(*) AS n FROM picks WHERE track_id = ?")
      .get(trackId) as { n: number };
    const pickRank = rankRow.n + 1;

    let pickId: number;
    try {
      const res = db
        .prepare(
          "INSERT INTO picks (user_id, track_id, picked_at, pick_date, pick_week, kind, baseline_snapshot_id, pick_rank, expires_at, status, artist_avg_plays) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)",
        )
        .run(
          userId,
          trackId,
          nowIso,
          pickDate,
          pickWeek,
          kind,
          baselineSnapshotId,
          pickRank,
          expiresAt,
          details.artistAvgPlays,
        );
      pickId = Number(res.lastInsertRowid);
    } catch (err) {
      // SQLite names the violated columns (not the index) in the message,
      // for table constraints and partial unique indexes alike.
      const msg = (err as Error).message;
      if (msg.includes("picks.user_id, picks.pick_date")) {
        throw new DomainError("already_picked_today", "You already used today's pick");
      }
      if (msg.includes("picks.user_id, picks.pick_week")) {
        throw new DomainError("super_pick_used", "You already used this week's super pick");
      }
      if (msg.includes("picks.user_id, picks.track_id")) {
        throw new DomainError("already_picked_track", "You already picked this track");
      }
      throw err;
    }

    updateStreak(db, userId, pickDate);
    notifyFollowers(
      db,
      userId,
      {
        pickerId: userId,
        pickerHandle: user.handle,
        trackId,
        kind,
        title: details.title,
        artistName: details.artistName,
        baselinePlays: details.stats.plays,
        tier:
          details.artistAvgPlays !== null
            ? underdogTierFor(details.artistAvgPlays).label
            : details.stats.plays !== null
              ? underdogTierFor(details.stats.plays).label
              : null,
      },
      nowIso,
    );

    const row = db.prepare("SELECT * FROM picks WHERE id = ?").get(pickId) as unknown as PickRow;
    return toPick(row);
  });
}

export interface PickView extends Pick {
  /** Score under this pick's badge — comparable only within that badge. */
  title: string;
  artistName: string;
  providerTrackId: string;
  baselinePlays: number | null;
  /** Artist popularity captured AT PICK TIME — the tier this pick is scored against. */
  artistAvgPlays: number | null;
  currentPlays: number | null;
  points: number;
  tierLabel: string | null;
}

/** A user's picks with track info, baseline vs. latest plays, and points. */
export function listPicksForUser(userId: number): PickView[] {
  const rows = getDb()
    .prepare(
      `SELECT p.*, t.title, t.artist_name, t.provider_track_id,
              p.artist_avg_plays,
              base.plays AS baseline_plays,
              (SELECT s.plays FROM track_snapshots s
                WHERE s.track_id = p.track_id ORDER BY s.captured_at DESC, s.id DESC LIMIT 1) AS current_plays,
              p.badge, p.badge_points, p.badge_at
         FROM picks p
         JOIN tracks t ON t.id = p.track_id
         JOIN track_snapshots base ON base.id = p.baseline_snapshot_id
        WHERE p.user_id = ?
        ORDER BY p.picked_at DESC`,
    )
    .all(userId) as unknown[];
  return (rows as (PickRow & {
    title: string;
    artist_name: string;
    provider_track_id: string;
    artist_avg_plays: number | null;
    baseline_plays: number | null;
    current_plays: number | null;
    badge: import("@firstfan/shared").Badge;
    badge_points: number;
    badge_at: string | null;
  })[]).map((r) => {
    const tierInput = r.artist_avg_plays ?? r.baseline_plays;
    return {
      ...toPick(r),
      title: r.title,
      artistName: r.artist_name,
      providerTrackId: r.provider_track_id,
      baselinePlays: r.baseline_plays,
      artistAvgPlays: r.artist_avg_plays,
      currentPlays: r.current_plays,
      points: r.badge_points,
      tierLabel: tierInput === null ? null : underdogTierFor(tierInput).label,
    };
  });
}
