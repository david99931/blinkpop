/** Which music platform a track lives on. Phase 1 only ships "mock". */
export type ProviderName = "mock" | "soundcloud";

/** Domain identity of a track is (provider, providerTrackId) — never a raw provider object. */
export interface TrackRef {
  provider: ProviderName;
  providerTrackId: string;
}

export interface Track extends TrackRef {
  id: number;
  title: string;
  artistName: string;
  artworkUrl: string | null;
  permalinkUrl: string | null;
  firstSeenAt: string; // ISO timestamp
}

/**
 * Stats may be null when the provider has stats disabled for a track
 * (real SoundCloud case). Picks on such tracks are "pending data" and
 * excluded from scoring until stats exist.
 */
export interface TrackStats {
  plays: number | null;
  likes: number | null;
  reposts: number | null;
  fetchedAt: string;
}

export interface TrackSnapshot {
  id: number;
  trackId: number;
  plays: number | null;
  likes: number | null;
  reposts: number | null;
  capturedAt: string;
}

export interface User {
  id: number;
  handle: string;
  displayName: string;
  email: string;
  tz: string;
  createdAt: string;
}

export type PickStatus = "active" | "expired";

/** "daily" = the everyday pick. "super" = the weekly 5× pick (extra slot). */
export type PickKind = "daily" | "super";

export interface Pick {
  id: number;
  userId: number;
  trackId: number;
  pickedAt: string;
  /** User-local calendar date (YYYY-MM-DD) — enforces one daily pick per day. */
  pickDate: string;
  /** User-local ISO week (e.g. "2026-W32") — enforces one super pick per week. */
  pickWeek: string;
  kind: PickKind;
  baselineSnapshotId: number;
  /** 1 = first user ever to pick this track. Assigned transactionally at confirmation. */
  pickRank: number;
  expiresAt: string;
  status: PickStatus;
}

export type ScoreEventType = "milestone" | "weekly_growth" | "early_bird";

export interface ScoreEvent {
  id: number;
  pickId: number;
  type: ScoreEventType;
  /** The play-count milestone crossed, for type "milestone"; null otherwise. */
  milestoneValue: number | null;
  points: number;
  computedAt: string;
  /** e.g. "pick:42:milestone:100000" — UNIQUE in the DB; makes settlement idempotent. */
  dedupeKey: string;
}

export interface Streak {
  userId: number;
  currentStreak: number;
  longestStreak: number;
  lastPickDate: string | null;
}

export type NotificationType =
  | "milestone_crossed"
  | "weekly_growth_awarded"
  | "early_bird_awarded"
  | "followed_user_picked"
  | "new_follower";

export interface AppNotification {
  id: number;
  userId: number;
  type: NotificationType;
  /** JSON payload, shape depends on type. */
  payload: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
}
