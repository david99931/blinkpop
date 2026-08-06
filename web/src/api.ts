/** Typed fetch layer. Identity is a bearer session token from /api/auth. */

const TOKEN_KEY = "ff_token";

export function currentToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token === null) localStorage.removeItem(TOKEN_KEY);
  else localStorage.setItem(TOKEN_KEY, token);
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
  const token = currentToken();
  const res = await fetch(path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token !== null ? { authorization: `Bearer ${token}` } : {}),
    },
    // Bodyless POST/DELETE still send "{}" — Fastify rejects an empty body
    // when content-type says JSON.
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
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
  artworkUrl: string | null;
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
    artworkUrl: string | null;
    artistAvgPlays: number | null;
    stats: { plays: number | null; likes: number | null; reposts: number | null };
  };
  tier: Tier | null;
  embed: { kind: "widget" | "fake"; embedUrl: string | null };
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
  mode: "sim" | "real";
  provider: string;
  simDay: number | null;
  simTime: string;
}

export interface AuthResult {
  user: UserInfo;
  token: string;
}

export interface ScStatus {
  connected: boolean;
  username?: string | null;
  connectedAt?: string;
}

export interface ScLikes {
  connected: boolean;
  tracks: SearchResult[];
  error?: string;
}
