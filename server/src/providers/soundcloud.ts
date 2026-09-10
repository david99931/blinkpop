/**
 * SoundCloudProvider — Phase 2, real API.
 *
 * Verified against the live API (2026-08-05 smoke test, scripts/check-soundcloud.mjs):
 * - Token: POST https://secure.soundcloud.com/oauth/token, Basic auth,
 *   grant_type=client_credentials, expires ~3600s → cached + auto-refreshed.
 * - Track stats fields as actually returned: `playback_count`,
 *   `favoritings_count` (NOT likes_count), `reposts_count`. Missing/disabled
 *   stats map to null; game logic already treats null baselines as pending.
 * - Rate limits are real: every call goes through one budgeted client with a
 *   small response cache. Artist averages are cached hard (one call per
 *   artist per TTL, via /users/{id}/tracks).
 *
 * Search results skip the artist-average lookup (25 extra calls per search
 * would burn the quota) — their tier badge falls back to track plays; the
 * track page and pick confirmation use getTrack, which computes the real
 * artist average. Baselines captured at pick time are therefore exact.
 */

import type {
  EmbedInfo,
  MusicProvider,
  TrackDetails,
  TrackSearchResult,
  TrackStats,
} from "@firstfan/shared";

const TOKEN_URL = "https://secure.soundcloud.com/oauth/token";
const API_BASE = "https://api.soundcloud.com";
const RESPONSE_CACHE_TTL_MS = 60_000;
const ARTIST_AVG_TTL_MS = 6 * 3_600_000;
const DAILY_CALL_BUDGET = 10_000;

export interface SoundCloudConfig {
  clientId: string;
  clientSecret: string;
}

export function soundCloudConfigFromEnv(): SoundCloudConfig | null {
  const clientId = process.env.SOUNDCLOUD_CLIENT_ID;
  const clientSecret = process.env.SOUNDCLOUD_CLIENT_SECRET;
  if (!clientId || !clientSecret || clientId.startsWith("paste_")) return null;
  return { clientId, clientSecret };
}

/** Raw track object fields we rely on (subset, from the live API). */
export interface ScTrack {
  id: number;
  title: string;
  permalink_url?: string | null;
  artwork_url?: string | null;
  playback_count?: number | null;
  favoritings_count?: number | null;
  reposts_count?: number | null;
  /** Single primary genre. Free text, so casing and wording vary wildly. */
  genre?: string | null;
  /** Space-separated tags; multi-word ones are quoted. See parseTagList. */
  tag_list?: string | null;
  user?: { id: number; username?: string; avatar_url?: string | null } | null;
}

export function mapTrack(t: ScTrack): Omit<TrackSearchResult, "artistAvgPlays"> {
  return {
    provider: "soundcloud",
    providerTrackId: String(t.id),
    title: t.title,
    artistName: t.user?.username ?? "Unknown artist",
    artworkUrl: t.artwork_url ?? t.user?.avatar_url ?? null,
    permalinkUrl: t.permalink_url ?? null,
    currentPlays: typeof t.playback_count === "number" ? t.playback_count : null,
  };
}

export function mapStats(t: ScTrack, fetchedAt: string): TrackStats {
  return {
    plays: typeof t.playback_count === "number" ? t.playback_count : null,
    likes: typeof t.favoritings_count === "number" ? t.favoritings_count : null,
    reposts: typeof t.reposts_count === "number" ? t.reposts_count : null,
    fetchedAt,
  };
}

class SoundCloudClient {
  private token: { value: string; expiresAtMs: number } | null = null;
  private budget = { windowStartMs: Date.now(), calls: 0 };
  private cache = new Map<string, { atMs: number; body: unknown }>();

  constructor(private readonly config: SoundCloudConfig) {}

  private async fetchToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAtMs - 60_000) return this.token.value;
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString(
      "base64",
    );
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json; charset=utf-8",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) {
      throw new Error(`SoundCloud token exchange failed: HTTP ${res.status}`);
    }
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = {
      value: body.access_token,
      expiresAtMs: Date.now() + body.expires_in * 1000,
    };
    return this.token.value;
  }

  private spendBudget(): void {
    const now = Date.now();
    if (now - this.budget.windowStartMs > 24 * 3_600_000) {
      this.budget = { windowStartMs: now, calls: 0 };
    }
    this.budget.calls++;
    if (this.budget.calls > DAILY_CALL_BUDGET) {
      throw new Error("SoundCloud daily call budget exhausted — backing off until the window resets");
    }
  }

  /** GET an API path (e.g. "/tracks?q=x"), with short-lived response caching. */
  async get<T>(pathAndQuery: string): Promise<T> {
    const cached = this.cache.get(pathAndQuery);
    if (cached && Date.now() - cached.atMs < RESPONSE_CACHE_TTL_MS) return cached.body as T;

    this.spendBudget();
    let token = await this.fetchToken();
    let res = await fetch(`${API_BASE}${pathAndQuery}`, {
      headers: { Authorization: `OAuth ${token}`, Accept: "application/json; charset=utf-8" },
    });
    if (res.status === 401) {
      // token revoked early — refresh once and retry
      this.token = null;
      token = await this.fetchToken();
      res = await fetch(`${API_BASE}${pathAndQuery}`, {
        headers: { Authorization: `OAuth ${token}`, Accept: "application/json; charset=utf-8" },
      });
    }
    if (!res.ok) {
      throw new Error(`SoundCloud API ${pathAndQuery} failed: HTTP ${res.status}`);
    }
    const body = (await res.json()) as T;
    this.cache.set(pathAndQuery, { atMs: Date.now(), body });
    if (this.cache.size > 500) {
      const oldest = [...this.cache.entries()].sort((a, b) => a[1].atMs - b[1].atMs)[0];
      if (oldest) this.cache.delete(oldest[0]);
    }
    return body;
  }
}

// ── User-token OAuth (account linking) ──────────────────────────────────
// Authorization-code flow with PKCE; tokens are per app-user and stored in
// connected_accounts. Separate from the app's client-credentials token.

export interface ScUserTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAtIso: string;
}

async function tokenPost(body: URLSearchParams, config: SoundCloudConfig): Promise<ScUserTokens> {
  body.set("client_id", config.clientId);
  body.set("client_secret", config.clientSecret);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json; charset=utf-8",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`SoundCloud user-token request failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAtIso: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };
}

export function authorizeUrl(config: SoundCloudConfig, redirectUri: string, state: string, codeChallenge: string): string {
  const q = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `https://secure.soundcloud.com/authorize?${q}`;
}

export function exchangeAuthCode(
  config: SoundCloudConfig,
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<ScUserTokens> {
  return tokenPost(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
    config,
  );
}

export function refreshUserToken(config: SoundCloudConfig, refreshToken: string): Promise<ScUserTokens> {
  return tokenPost(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    config,
  );
}

/** GET an API path with a USER's token (e.g. "/me", "/me/likes/tracks?limit=12"). */
export async function scUserGet<T>(pathAndQuery: string, accessToken: string): Promise<T> {
  const res = await fetch(`${API_BASE}${pathAndQuery}`, {
    headers: { Authorization: `OAuth ${accessToken}`, Accept: "application/json; charset=utf-8" },
  });
  if (!res.ok) throw new Error(`SoundCloud user API ${pathAndQuery} failed: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export class SoundCloudProvider implements MusicProvider {
  readonly name = "soundcloud" as const;
  private readonly client: SoundCloudClient;
  private artistAvgCache = new Map<number, { atMs: number; avg: number | null }>();

  constructor(config: SoundCloudConfig) {
    this.client = new SoundCloudClient(config);
  }

  async searchTracks(query: string): Promise<TrackSearchResult[]> {
    const q = query.trim();
    if (!q) return []; // no browse-everything endpoint worth the quota
    const list = await this.client.get<ScTrack[] | { collection: ScTrack[] }>(
      `/tracks?q=${encodeURIComponent(q)}&limit=25&access=playable`,
    );
    const tracks = Array.isArray(list) ? list : (list.collection ?? []);
    // artistAvgPlays deliberately null here — see module docblock.
    return tracks.map((t) => ({ ...mapTrack(t), artistAvgPlays: null }));
  }

  private async artistAvgPlays(userId: number): Promise<number | null> {
    const cached = this.artistAvgCache.get(userId);
    if (cached && Date.now() - cached.atMs < ARTIST_AVG_TTL_MS) return cached.avg;
    let avg: number | null = null;
    try {
      const list = await this.client.get<ScTrack[] | { collection: ScTrack[] }>(
        `/users/${userId}/tracks?limit=50`,
      );
      const tracks = Array.isArray(list) ? list : (list.collection ?? []);
      const plays = tracks
        .map((t) => t.playback_count)
        .filter((p): p is number => typeof p === "number");
      avg = plays.length > 0 ? Math.round(plays.reduce((s, p) => s + p, 0) / plays.length) : null;
    } catch {
      avg = null; // artist stats unavailable → scoring falls back to track baseline
    }
    this.artistAvgCache.set(userId, { atMs: Date.now(), avg });
    return avg;
  }

  async getTrack(providerTrackId: string): Promise<TrackDetails> {
    const t = await this.client.get<ScTrack>(`/tracks/${encodeURIComponent(providerTrackId)}`);
    const fetchedAt = new Date().toISOString();
    const artistAvg = t.user?.id ? await this.artistAvgPlays(t.user.id) : null;
    return { ...mapTrack(t), artistAvgPlays: artistAvg, stats: mapStats(t, fetchedAt) };
  }

  async getTrackStats(providerTrackId: string): Promise<TrackStats> {
    const t = await this.client.get<ScTrack>(`/tracks/${encodeURIComponent(providerTrackId)}`);
    return mapStats(t, new Date().toISOString());
  }

  getEmbed(providerTrackId: string): EmbedInfo {
    // The widget accepts api track URLs directly; it carries SoundCloud
    // branding + linkback natively (attribution requirement).
    const trackUrl = encodeURIComponent(`${API_BASE}/tracks/${providerTrackId}`);
    return {
      provider: "soundcloud",
      kind: "widget",
      embedUrl: `https://w.soundcloud.com/player/?url=${trackUrl}&auto_play=false&show_comments=false&visual=false&color=%237aa2ff`,
    };
  }
}
