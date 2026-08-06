import type { FastifyInstance } from "fastify";
import { getDb } from "../db/db.ts";
import { simNow } from "../sim/clock.ts";

const WINDOW_DAYS = 7;
const MAX_SERIES_POINTS = 120;
const LIMIT = 20;

export interface TrendingItem {
  provider: string;
  providerTrackId: string;
  title: string;
  artistName: string;
  artworkUrl: string | null;
  currentPlays: number | null;
  /** plays gained across the trending window (or since tracking began if younger) */
  deltaPlays: number;
  deltaPct: number | null;
  pickersTotal: number;
  pickersRecent: number;
  sparkline: { plays: number; capturedAt: string }[];
}

/** Evenly thin a series so the payload stays light but the shape survives. */
function downsample<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  const out: T[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]!);
  return out;
}

/**
 * Trending = what the players themselves are calling. Ranked by pickers in
 * the last 7 days (the app's own social signal), tie-broken by play growth
 * over the same window. Only picked tracks have snapshot history, so this
 * is exactly the set we can chart.
 */
export function buildTrending(): TrendingItem[] {
  const db = getDb();
  const windowStart = new Date(simNow().getTime() - WINDOW_DAYS * 86_400_000).toISOString();

  const tracks = db
    .prepare(
      `SELECT t.id, t.provider, t.provider_track_id, t.title, t.artist_name, t.artwork_url,
              (SELECT COUNT(*) FROM picks p WHERE p.track_id = t.id) AS pickers_total,
              (SELECT COUNT(*) FROM picks p WHERE p.track_id = t.id AND p.picked_at >= ?) AS pickers_recent
         FROM tracks t
        WHERE EXISTS (SELECT 1 FROM picks p WHERE p.track_id = t.id)`,
    )
    .all(windowStart) as {
    id: number;
    provider: string;
    provider_track_id: string;
    title: string;
    artist_name: string;
    artwork_url: string | null;
    pickers_total: number;
    pickers_recent: number;
  }[];

  const seriesFor = db.prepare(
    "SELECT plays, captured_at AS capturedAt FROM track_snapshots WHERE track_id = ? AND plays IS NOT NULL ORDER BY captured_at",
  );

  const items = tracks.map((t): TrendingItem => {
    const series = seriesFor.all(t.id) as unknown as { plays: number; capturedAt: string }[];
    const latest = series[series.length - 1] ?? null;
    const windowBase =
      series.find((s) => s.capturedAt >= windowStart) ?? series[0] ?? null;
    const deltaPlays = latest && windowBase ? latest.plays - windowBase.plays : 0;
    const deltaPct =
      latest && windowBase && windowBase.plays > 0
        ? (deltaPlays / windowBase.plays) * 100
        : null;
    return {
      provider: t.provider,
      providerTrackId: t.provider_track_id,
      title: t.title,
      artistName: t.artist_name,
      artworkUrl: t.artwork_url,
      currentPlays: latest?.plays ?? null,
      deltaPlays,
      deltaPct,
      pickersTotal: t.pickers_total,
      pickersRecent: t.pickers_recent,
      sparkline: downsample(series, MAX_SERIES_POINTS),
    };
  });

  items.sort(
    (a, b) =>
      b.pickersRecent - a.pickersRecent ||
      (b.deltaPct ?? -Infinity) - (a.deltaPct ?? -Infinity) ||
      b.pickersTotal - a.pickersTotal,
  );
  return items.slice(0, LIMIT);
}

export async function trendingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/trending", async () => ({ windowDays: WINDOW_DAYS, items: buildTrending() }));
}
