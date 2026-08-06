import type { FastifyInstance } from "fastify";
import { underdogTierFor } from "@firstfan/shared";
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
                COALESCE((SELECT SUM(e.points) FROM score_events e WHERE e.pick_id = p.id), 0) AS points
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
    }[]
  ).map((r) => ({
    rank: r.pick_rank,
    kind: r.kind,
    handle: r.handle,
    displayName: r.display_name,
    baselinePlays: r.baseline_plays,
    pickedAt: r.picked_at,
    points: r.points,
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
      try {
        const track = await provider.getTrack(req.params.providerTrackId);
        const tierInput = track.artistAvgPlays ?? track.stats.plays;
        return {
          track,
          tier: tierInput === null ? null : underdogTierFor(tierInput),
          embed: provider.getEmbed(req.params.providerTrackId),
          ...trackPageExtras(req.params.providerTrackId),
        };
      } catch {
        return reply.code(404).send({ error: "track_not_found" });
      }
    },
  );
}
