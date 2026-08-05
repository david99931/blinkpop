/** Typed fetch layer. Identity is the Phase 1 dev header (x-user-id). */

const USER_KEY = "ff_user_id";

export function currentUserId(): number | null {
  const raw = localStorage.getItem(USER_KEY);
  const id = raw === null ? NaN : Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function setCurrentUserId(id: number | null): void {
  if (id === null) localStorage.removeItem(USER_KEY);
  else localStorage.setItem(USER_KEY, String(id));
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const userId = currentUserId();
  const res = await fetch(path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(userId !== null ? { "x-user-id": String(userId) } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      String(data.error ?? "unknown"),
      String(data.message ?? data.error ?? `HTTP ${res.status}`),
    );
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};

// ── Response shapes (mirroring the server routes) ──

export interface UserInfo {
  id: number;
  handle: string;
  displayName: string;
  email: string;
  tz: string;
}

export interface Tier {
  multiplier: number;
  label: string;
}

export interface SearchResult {
  provider: string;
  providerTrackId: string;
  title: string;
  artistName: string;
  currentPlays: number | null;
  artistAvgPlays: number | null;
  tier: Tier | null;
}

export interface SnapshotPoint {
  plays: number | null;
  capturedAt: string;
}

export interface TrackPageData {
  track: {
    providerTrackId: string;
    title: string;
    artistName: string;
    artistAvgPlays: number | null;
    stats: { plays: number | null; likes: number | null; reposts: number | null };
  };
  tier: Tier | null;
  sparkline: SnapshotPoint[];
  pickers: {
    rank: number;
    handle: string;
    displayName: string;
    baselinePlays: number | null;
    pickedAt: string;
    points: number;
  }[];
}

export interface PickView {
  id: number;
  pickDate: string;
  pickRank: number;
  kind: "daily" | "super";
  status: "active" | "expired";
  title: string;
  artistName: string;
  providerTrackId: string;
  baselinePlays: number | null;
  currentPlays: number | null;
  points: number;
  tierLabel: string | null;
}

export interface MyPicks {
  picks: PickView[];
  pickedToday: boolean;
  superAvailable: boolean;
  today: string;
  week: string;
}

export interface PortfolioData {
  user: { handle: string; displayName: string; createdAt: string };
  totalPoints: number;
  currentStreak: number;
  longestStreak: number;
  bestPickId: number | null;
  picks: (PickView & {
    events: { type: string; milestoneValue: number | null; points: number; at: string }[];
  })[];
}

export interface FeedItem {
  kind: "pick" | "score";
  at: string;
  handle: string;
  displayName: string;
  title: string;
  artistName: string;
  providerTrackId: string;
  baselinePlays?: number | null;
  tierLabel?: string | null;
  superPick?: boolean;
  eventType?: "milestone" | "weekly_growth" | "early_bird";
  milestoneValue?: number | null;
  points?: number;
}

export interface LeaderboardData {
  rows: {
    rank: number;
    userId: number;
    handle: string;
    displayName: string;
    points: number;
    picks: number;
  }[];
  season?: string;
}

export interface NotificationsData {
  unreadCount: number;
  notifications: {
    id: number;
    type: string;
    payload: Record<string, unknown>;
    createdAt: string;
    readAt: string | null;
  }[];
}

export interface ClockData {
  simDay: number;
  simTime: string;
}
