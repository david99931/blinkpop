/**
 * Spotify — a TASTE source, not a track source.
 *
 * The Web API exposes `popularity` (0–100) and no play counts anywhere, so a
 * Spotify track can never be picked or scored by this game; that is precisely
 * why the game runs on SoundCloud. Nothing here implements MusicProvider, and
 * nothing here should ever be imported by scoring or settlement.
 *
 * What it does give, the moment a user links:
 *   - top artists and tracks over ~4 weeks / ~6 months / ~1 year
 *   - GENRES, carried on artist objects — the seed for discovery
 *   - the last 50 plays, with timestamps
 *
 * There is no listening time and no per-track play count in the API. Those come
 * only from accumulating `recently-played` over time, or from the user's data
 * export. See ROADMAP.
 */

import type { LinkTokens } from "../domain/linked-accounts.ts";

const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_BASE = "https://api.spotify.com/v1";

/**
 * Read-only, and deliberately minimal — every extra scope is another thing the
 * consent screen asks for and another reason to decline.
 */
export const SPOTIFY_SCOPES = [
  "user-top-read",
  "user-read-recently-played",
  "user-library-read",
].join(" ");

export interface SpotifyConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function spotifyConfigFromEnv(): SpotifyConfig | null {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  if (clientId.startsWith("paste_")) return null;
  return { clientId, clientSecret, redirectUri };
}

function tokensFrom(json: {
  access_token: string;
  refresh_token?: string | null;
  expires_in?: number;
}): LinkTokens {
  return {
    accessToken: json.access_token,
    // A refresh response often omits refresh_token, meaning "keep the old one".
    // Returning null here would wipe it, so the caller must preserve it.
    refreshToken: json.refresh_token ?? null,
    expiresAtIso: new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString(),
  };
}

async function tokenPost(body: URLSearchParams, config: SpotifyConfig): Promise<LinkTokens> {
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Spotify token exchange failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  return tokensFrom(await res.json());
}

export function authorizeUrl(config: SpotifyConfig, state: string, codeChallenge: string): string {
  const q = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    state,
    scope: SPOTIFY_SCOPES,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
  });
  return `${AUTH_URL}?${q}`;
}

export function exchangeAuthCode(config: SpotifyConfig, code: string, verifier: string): Promise<LinkTokens> {
  return tokenPost(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      code_verifier: verifier,
    }),
    config,
  );
}

export function refreshUserToken(config: SpotifyConfig, refreshToken: string): Promise<LinkTokens> {
  return tokenPost(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    config,
  );
}

export async function spGet<T>(pathAndQuery: string, accessToken: string): Promise<T> {
  const res = await fetch(`${API_BASE}${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Spotify ${pathAndQuery} failed: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

// ── shapes we actually read (subsets of much larger objects) ──

export interface SpArtist {
  id: string;
  name: string;
  genres?: string[];
  images?: { url: string; width: number | null; height: number | null }[];
  popularity?: number;
}

export interface SpTrack {
  id: string;
  name: string;
  artists: { id: string; name: string }[];
  album?: { name: string; images?: { url: string }[] };
  popularity?: number;
  duration_ms?: number;
}

export type TimeRange = "short_term" | "medium_term" | "long_term";

/** Human labels for the three windows the API offers. */
export const TIME_RANGE_LABEL: Record<TimeRange, string> = {
  short_term: "last 4 weeks",
  medium_term: "last 6 months",
  long_term: "last year",
};

export function topArtists(accessToken: string, range: TimeRange, limit = 50): Promise<{ items: SpArtist[] }> {
  return spGet(`/me/top/artists?time_range=${range}&limit=${limit}`, accessToken);
}

export function topTracks(accessToken: string, range: TimeRange, limit = 50): Promise<{ items: SpTrack[] }> {
  return spGet(`/me/top/tracks?time_range=${range}&limit=${limit}`, accessToken);
}

export function recentlyPlayed(accessToken: string, limit = 50): Promise<{
  items: { track: SpTrack; played_at: string }[];
}> {
  return spGet(`/me/player/recently-played?limit=${limit}`, accessToken);
}

export function currentUser(accessToken: string): Promise<{ id: string; display_name?: string | null }> {
  return spGet("/me", accessToken);
}

/**
 * A weighted genre profile from top artists — the seed discovery consumes.
 *
 * Weighted by rank rather than counted flat, because the artist you play most
 * should say more about your taste than the fiftieth. Spotify puts genres on
 * ARTISTS, never on tracks, which is why this reads artists.
 */
export function genreProfile(artists: SpArtist[]): { genre: string; weight: number }[] {
  const weights = new Map<string, number>();
  artists.forEach((artist, i) => {
    const rankWeight = 1 / (i + 1); // harmonic decay: #1 counts 50x the #50
    for (const genre of artist.genres ?? []) {
      weights.set(genre, (weights.get(genre) ?? 0) + rankWeight);
    }
  });
  return [...weights]
    .map(([genre, weight]) => ({ genre, weight: Number(weight.toFixed(4)) }))
    .sort((a, b) => b.weight - a.weight);
}
