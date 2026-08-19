import type { FastifyInstance } from "fastify";
import { underdogTierFor } from "@firstfan/shared";
import type { TrackDetails } from "@firstfan/shared";
import { activeProviderName, getActiveProvider } from "../providers/index.ts";
import { getDb } from "../db/db.ts";

/**
 * Extra track-page data that only exists once someone has picked the track:
 * the snapshot time series (sparkline) and the "OG board" — pickers ranked
 * by pick order with their baselines (spec §8.6).
 */
function trackPageExtras(providerTrackId: string): {
  sparkline: { plays: number | null; capturedAt: string }[];
  pickers: {
    rank: number;
    handle: string;
    displayName: string;
    baselinePlays: number | null;
    pickedAt: string;
    points: number;
    kind: "daily" | "super";
    badge: string;
    badgeSecond: string | null;
  }[];
} {
  const db = getDb();
  const track = db
    .prepare("SELECT id FROM tracks WHERE provider = ? AND provider_track_id = ?")
    .get(activeProviderName(), providerTrackId) as { id: number } | undefined;
  if (!track) return { sparkline: [], pickers: [] };

  const sparkline = db
    .prepare(
      "SELECT plays, captured_at AS capturedAt FROM track_snapshots WHERE track_id = ? ORDER BY captured_at",
    )
    .all(track.id) as { plays: number | null; capturedAt: string }[];

  const pickers = (
    db
      .prepare(
        `SELECT p.pick_rank, p.kind, u.handle, u.display_name, base.plays AS baseline_plays, p.picked_at,
                p.badge_points AS points, p.badge, p.badge_second
           FROM picks p
           JOIN users u ON u.id = p.user_id
           JOIN track_snapshots base ON base.id = p.baseline_snapshot_id
          WHERE p.track_id = ? ORDER BY p.pick_rank`,
      )
      .all(track.id) as {
      pick_rank: number;
      kind: "daily" | "super";
      handle: string;
      display_name: string;
      baseline_plays: number | null;
      picked_at: string;
      points: number;
      badge: string;
      badge_second: string | null;
    }[]
  ).map((r) => ({
    rank: r.pick_rank,
    kind: r.kind,
    handle: r.handle,
    displayName: r.display_name,
    baselinePlays: r.baseline_plays,
    pickedAt: r.picked_at,
    points: r.points,
    badge: r.badge,
    badgeSecond: r.badge_second,
  }));

  return { sparkline, pickers };
}

export async function trackRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { q?: string } }>("/api/tracks/search", async (req) => {
    const provider = getActiveProvider();
    const results = await provider.searchTracks(req.query.q ?? "");
    return {
      results: results.map((r) => {
        const tierInput = r.artistAvgPlays ?? r.currentPlays;
        return { ...r, tier: tierInput === null ? null : underdogTierFor(tierInput) };
      }),
    };
  });

  // "t" = the active provider's namespace; the app runs one provider at a time.
  app.get<{ Params: { providerTrackId: string } }>(
    "/api/tracks/t/:providerTrackId",
    async (req, reply) => {
      const provider = getActiveProvider();
      let track: Awaited<ReturnType<typeof provider.getTrack>> | null = null;
      try {
        track = await provider.getTrack(req.params.providerTrackId);
      } catch {
        // Fall back to what we already stored. A track somebody PICKED must
        // stay viewable even when the provider no longer serves it — deleted
        // upstream, an API blip, or a track we hold that the active provider
        // never knew about. Losing the page would strip a user of the evidence
        // behind a badge they earned.
        track = trackFromDb(req.params.providerTrackId);
      }
      if (!track) return reply.code(404).send({ error: "track_not_found" });

      const tierInput = track.artistAvgPlays ?? track.stats.plays;
      return {
        track,
        tier: tierInput === null ? null : underdogTierFor(tierInput),
        embed: provider.getEmbed(req.params.providerTrackId),
        ...trackPageExtras(req.params.providerTrackId),
      };
    },
  );
}

/**
 * Rebuild a TrackDetails from our own tables — title and artist from `tracks`,
 * stats from the newest snapshot. Used only when the provider cannot serve a
 * track we already hold.
 */
function trackFromDb(providerTrackId: string): TrackDetails | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT t.id, t.provider, t.provider_track_id, t.title, t.artist_name,
              t.artwork_url, t.permalink_url
         FROM tracks t WHERE t.provider_track_id = ?`,
    )
    .get(providerTrackId) as
    | { id: number; provider: string; provider_track_id: string; title: string;
        artist_name: string; artwork_url: string | null; permalink_url: string | null }
    | undefined;
  if (!row) return null;

  const snap = db
    .prepare(
      "SELECT plays, likes, reposts, captured_at FROM track_snapshots " +
        "WHERE track_id = ? ORDER BY captured_at DESC LIMIT 1",
    )
    .get(row.id) as
    | { plays: number | null; likes: number | null; reposts: number | null; captured_at: string }
    | undefined;

  return {
    provider: row.provider as TrackDetails["provider"],
    providerTrackId: row.provider_track_id,
    title: row.title,
    artistName: row.artist_name,
    artworkUrl: row.artwork_url,
    permalinkUrl: row.permalink_url,
    currentPlays: snap?.plays ?? null,
    artistAvgPlays: null,
    stats: {
      plays: snap?.plays ?? null,
      likes: snap?.likes ?? null,
      reposts: snap?.reposts ?? null,
      fetchedAt: snap?.captured_at ?? new Date().toISOString(),
    },
  };
}
