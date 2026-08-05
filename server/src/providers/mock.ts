import type {
  EmbedInfo,
  MusicProvider,
  TrackDetails,
  TrackSearchResult,
  TrackStats,
} from "@firstfan/shared";
import { getUniverse, type SimTrack } from "../sim/catalog.ts";
import { simDay, simNow } from "../sim/clock.ts";

/** artistName → their tracks, built once per universe. */
const artistIndexes = new WeakMap<Map<string, SimTrack>, Map<string, SimTrack[]>>();

function artistTracks(universe: Map<string, SimTrack>, artistName: string): SimTrack[] {
  let index = artistIndexes.get(universe);
  if (!index) {
    index = new Map();
    for (const t of universe.values()) {
      const list = index.get(t.artistName) ?? [];
      list.push(t);
      index.set(t.artistName, list);
    }
    artistIndexes.set(universe, index);
  }
  return index.get(artistName) ?? [];
}

/**
 * Artist popularity = mean current plays across their catalog. In the mock
 * world artist identity is the exact name; SoundCloud will use the user id.
 */
export function artistAvgPlays(
  universe: Map<string, SimTrack>,
  artistName: string,
  day: number,
): number {
  const tracks = artistTracks(universe, artistName);
  if (tracks.length === 0) return 0;
  const total = tracks.reduce((s, t) => s + t.statsAt(day).plays, 0);
  return Math.round(total / tracks.length);
}

function toSearchResult(t: SimTrack, day: number): TrackSearchResult {
  return {
    provider: "mock",
    providerTrackId: t.providerTrackId,
    title: t.title,
    artistName: t.artistName,
    artworkUrl: null, // UI renders a deterministic gradient from the track id
    permalinkUrl: null,
    currentPlays: t.statsAt(day).plays,
    artistAvgPlays: artistAvgPlays(getUniverse(), t.artistName, day),
  };
}

export class MockProvider implements MusicProvider {
  readonly name = "mock" as const;

  async searchTracks(query: string): Promise<TrackSearchResult[]> {
    const day = simDay();
    const q = query.trim().toLowerCase();
    const all = [...getUniverse().values()];
    const matches = q
      ? all.filter(
          (t) =>
            t.title.toLowerCase().includes(q) || t.artistName.toLowerCase().includes(q),
        )
      : // Empty query = "discover": a stable slice, small tracks first so the
        // interesting (high-multiplier) picks surface.
        all.sort((a, b) => a.statsAt(day).plays - b.statsAt(day).plays);
    return matches.slice(0, 25).map((t) => toSearchResult(t, day));
  }

  async getTrack(providerTrackId: string): Promise<TrackDetails> {
    const t = getUniverse().get(providerTrackId);
    if (!t) throw new Error(`Unknown mock track: ${providerTrackId}`);
    return { ...toSearchResult(t, simDay()), stats: await this.getTrackStats(providerTrackId) };
  }

  async getTrackStats(providerTrackId: string): Promise<TrackStats> {
    const t = getUniverse().get(providerTrackId);
    if (!t) throw new Error(`Unknown mock track: ${providerTrackId}`);
    const s = t.statsAt(simDay());
    return { plays: s.plays, likes: s.likes, reposts: s.reposts, fetchedAt: simNow().toISOString() };
  }

  getEmbed(_providerTrackId: string): EmbedInfo {
    return { provider: "mock", kind: "fake", embedUrl: null };
  }
}
