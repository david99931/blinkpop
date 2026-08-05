import type { ProviderName, TrackStats } from "./types.ts";

export interface TrackSearchResult {
  provider: ProviderName;
  providerTrackId: string;
  title: string;
  artistName: string;
  artworkUrl: string | null;
  permalinkUrl: string | null;
  currentPlays: number | null;
  /**
   * Average plays across this artist's tracks right now — drives the
   * underdog tier. null when the provider can't supply artist stats
   * (scoring then falls back to the track's baseline plays).
   */
  artistAvgPlays: number | null;
}

export interface TrackDetails extends TrackSearchResult {
  stats: TrackStats;
}

/** What the UI needs to render a player for this track. */
export interface EmbedInfo {
  provider: ProviderName;
  /** "widget" = real embeddable player (SoundCloud); "fake" = mock player UI. */
  kind: "widget" | "fake";
  /** For widgets: the URL/payload the embed needs. For fake: unused. */
  embedUrl: string | null;
}

/**
 * The ONLY doorway between game logic and any music platform.
 * Game logic (picks, scoring, feed, leaderboards) must never import
 * provider-specific code — only this interface.
 */
export interface MusicProvider {
  readonly name: ProviderName;
  searchTracks(query: string): Promise<TrackSearchResult[]>;
  getTrack(providerTrackId: string): Promise<TrackDetails>;
  getTrackStats(providerTrackId: string): Promise<TrackStats>;
  getEmbed(providerTrackId: string): EmbedInfo;
}
