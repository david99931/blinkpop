/**
 * Phase 2 provider — STUB. Not registered in the provider map yet.
 *
 * Implementation notes carried from the spec (§5):
 * - Auth: client-credentials flow (no user OAuth). Config below; credentials
 *   will be provided later — never commit them.
 * - Stats fields: verify exact names against the CURRENT OpenAPI spec at
 *   developers.soundcloud.com (playback_count / likes_count / reposts_count
 *   have shifted historically — do not trust docs-from-memory).
 * - Some tracks have stats disabled → return null stats; game logic already
 *   treats null baselines as "pending data" and excludes them from scoring.
 * - Rate limits are real: route EVERY call through one client with request
 *   budgeting + caching. Only ever poll tracks that have been picked.
 * - Playback: SoundCloud widget embed; always show SoundCloud branding and
 *   link back to the track page (attribution requirement).
 */

import type {
  EmbedInfo,
  MusicProvider,
  TrackDetails,
  TrackSearchResult,
  TrackStats,
} from "@firstfan/shared";

export interface SoundCloudConfig {
  clientId: string;
  clientSecret: string;
}

export function soundCloudConfigFromEnv(): SoundCloudConfig | null {
  const clientId = process.env.SOUNDCLOUD_CLIENT_ID;
  const clientSecret = process.env.SOUNDCLOUD_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export class SoundCloudProvider implements MusicProvider {
  readonly name = "soundcloud" as const;

  constructor(private readonly config: SoundCloudConfig) {}

  async searchTracks(_query: string): Promise<TrackSearchResult[]> {
    // TODO(phase2): GET /tracks?q=... via the budgeted client; map fields.
    // artistAvgPlays: mean playback_count over the artist's tracks
    // (GET /users/{id}/tracks, cached hard — it's one call per artist, not per
    // track). Emit null when unavailable; scoring falls back to track baseline.
    throw new Error("SoundCloudProvider not implemented (Phase 2)");
  }

  async getTrack(_providerTrackId: string): Promise<TrackDetails> {
    // TODO(phase2): GET /tracks/{id}; null stats when the track disables them.
    throw new Error("SoundCloudProvider not implemented (Phase 2)");
  }

  async getTrackStats(_providerTrackId: string): Promise<TrackStats> {
    // TODO(phase2): same fetch as getTrack, trimmed to stats + fetchedAt.
    throw new Error("SoundCloudProvider not implemented (Phase 2)");
  }

  getEmbed(providerTrackId: string): EmbedInfo {
    // TODO(phase2): widget URL via oEmbed/permalink; keep SC branding visible.
    return { provider: "soundcloud", kind: "widget", embedUrl: null };
  }
}
