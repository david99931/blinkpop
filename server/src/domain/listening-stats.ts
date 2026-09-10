/**
 * Listening statistics from an imported Spotify history.
 *
 * Serves two audiences at once, deliberately:
 *   - the USER, who wants fun facts ("you've had Juice WRLD since May 2018")
 *   - US, because the SHAPE of someone's listening is what a discovery
 *     algorithm has to be designed around, and it is not what you'd guess.
 *
 * The measured shape on real data is a broad sampler, not a narrow superfan:
 * the top 10 artists account for only ~18% of listening time, 44% of artists
 * were played exactly once, and 58% of tracks were played exactly once. Someone
 * like that wants VOLUME and variety from discovery, not deeper cuts from
 * artists they already play daily.
 *
 * Which is why `seedArtists` is the mid-tail rather than the top: an artist
 * played 5-30 times is a real signal (not an accident) while still being
 * specific enough to lead somewhere new. The top 10 are the worst possible
 * seeds — mainstream, and already exhausted.
 */

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_DB =
  process.env.SPOTIFY_HISTORY_DB ?? path.join(HERE, "..", "..", "firstfan-spotify.db");

export interface ArtistStat {
  name: string;
  plays: number;
  hours: number;
  trackCount: number;
  firstPlayed: string;
  lastPlayed: string;
}

export interface ListeningStats {
  imported: boolean;
  /** Headline numbers — the fun-facts layer. */
  totals: {
    hours: number;
    tracks: number;
    artists: number;
    plays: number;
    spanStart: string | null;
    spanEnd: string | null;
    importedAt: string | null;
  };
  topArtists: ArtistStat[];
  topTracks: { title: string; artist: string; plays: number; hours: number; firstPlayed: string }[];
  /** Longest-running: still played recently, first played long ago. */
  loyalties: ArtistStat[];
  byYear: { year: string; newArtists: number; newTracks: number }[];
  /** Share of listening time held by the top N artists — how concentrated taste is. */
  concentration: { topN: number; share: number }[];
  /** Artists grouped by how many times they were played. */
  tail: { bucket: string; artists: number; share: number }[];
  oneAndDone: { tracks: number; share: number };
  /** The mid-tail: real interest, still specific. What discovery should seed from. */
  seedArtists: ArtistStat[];
}

const EMPTY: ListeningStats = {
  imported: false,
  totals: { hours: 0, tracks: 0, artists: 0, plays: 0, spanStart: null, spanEnd: null, importedAt: null },
  topArtists: [], topTracks: [], loyalties: [], byYear: [],
  concentration: [], tail: [], oneAndDone: { tracks: 0, share: 0 }, seedArtists: [],
};

const hours = (ms: number): number => Number((ms / 3_600_000).toFixed(1));
const pct = (n: number, d: number): number => (d ? Number(((n / d) * 100).toFixed(1)) : 0);

/** An artist played this many times is interested-but-not-exhausted. */
const SEED_MIN_PLAYS = 5;
const SEED_MAX_PLAYS = 30;

export function listeningStats(userId: number): ListeningStats {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(HISTORY_DB, { readOnly: true });
  } catch {
    return EMPTY; // no import yet — not an error, just nothing to show
  }

  try {
    const meta = db
      .prepare("SELECT imported_at, span_start, span_end FROM spotify_import WHERE user_id = ?")
      .get(userId) as { imported_at: string; span_start: string; span_end: string } | undefined;
    if (!meta) return EMPTY;

    const artists = db
      .prepare(
        `SELECT artist_name, play_count, ms_played, track_count, first_played, last_played
           FROM spotify_artist_history WHERE user_id = ?`,
      )
      .all(userId) as unknown as {
      artist_name: string; play_count: number; ms_played: number;
      track_count: number; first_played: string; last_played: string;
    }[];

    const toStat = (a: (typeof artists)[number]): ArtistStat => ({
      name: a.artist_name,
      plays: a.play_count,
      hours: hours(a.ms_played),
      trackCount: a.track_count,
      firstPlayed: a.first_played,
      lastPlayed: a.last_played,
    });

    const totalMs = artists.reduce((s, a) => s + a.ms_played, 0);
    const totalPlays = artists.reduce((s, a) => s + a.play_count, 0);
    const byMs = artists.slice().sort((x, y) => y.ms_played - x.ms_played);

    const trackCount = (db.prepare("SELECT COUNT(*) c FROM spotify_track_history WHERE user_id = ?").get(userId) as { c: number }).c;
    const onceCount = (db.prepare("SELECT COUNT(*) c FROM spotify_track_history WHERE user_id = ? AND play_count = 1").get(userId) as { c: number }).c;

    const topTracks = (db
      .prepare(
        `SELECT track_name, artist_name, play_count, ms_played, first_played
           FROM spotify_track_history WHERE user_id = ?
          ORDER BY play_count DESC LIMIT 15`,
      )
      .all(userId) as unknown as {
      track_name: string; artist_name: string; play_count: number; ms_played: number; first_played: string;
    }[]).map((t) => ({
      title: t.track_name ?? "Unknown",
      artist: t.artist_name ?? "Unknown",
      plays: t.play_count,
      hours: hours(t.ms_played),
      firstPlayed: t.first_played,
    }));

    // Loyalty = still playing them lately, but found them long ago. A pure
    // "oldest first play" list is mostly artists someone abandoned in 2016.
    const recentCutoff = new Date(Date.now() - 180 * 86_400_000).toISOString();
    const loyalties = artists
      .filter((a) => a.last_played >= recentCutoff && a.play_count >= 20)
      .sort((x, y) => x.first_played.localeCompare(y.first_played))
      .slice(0, 10)
      .map(toStat);

    const years = new Map<string, { newArtists: number; newTracks: number }>();
    for (const a of artists) {
      const y = a.first_played.slice(0, 4);
      years.set(y, { newArtists: (years.get(y)?.newArtists ?? 0) + 1, newTracks: years.get(y)?.newTracks ?? 0 });
    }
    for (const r of db
      .prepare(
        "SELECT substr(first_played,1,4) y, COUNT(*) n FROM spotify_track_history WHERE user_id = ? GROUP BY y",
      )
      .all(userId) as unknown as { y: string; n: number }[]) {
      years.set(r.y, { newArtists: years.get(r.y)?.newArtists ?? 0, newTracks: r.n });
    }

    const buckets: [string, (c: number) => boolean][] = [
      ["once", (c) => c === 1],
      ["2–4", (c) => c >= 2 && c < 5],
      ["5–9", (c) => c >= 5 && c < 10],
      ["10–29", (c) => c >= 10 && c < 30],
      ["30–99", (c) => c >= 30 && c < 100],
      ["100+", (c) => c >= 100],
    ];

    return {
      imported: true,
      totals: {
        hours: hours(totalMs),
        tracks: trackCount,
        artists: artists.length,
        plays: totalPlays,
        spanStart: meta.span_start,
        spanEnd: meta.span_end,
        importedAt: meta.imported_at,
      },
      topArtists: byMs.slice(0, 15).map(toStat),
      topTracks,
      loyalties,
      byYear: [...years]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([year, v]) => ({ year, ...v })),
      concentration: [10, 25, 50, 100, 250, 500].map((topN) => ({
        topN,
        share: pct(byMs.slice(0, topN).reduce((s, a) => s + a.ms_played, 0), totalMs),
      })),
      tail: buckets.map(([bucket, test]) => {
        const n = artists.filter((a) => test(a.play_count)).length;
        return { bucket, artists: n, share: pct(n, artists.length) };
      }),
      oneAndDone: { tracks: onceCount, share: pct(onceCount, trackCount) },
      seedArtists: artists
        .filter((a) => a.play_count >= SEED_MIN_PLAYS && a.play_count <= SEED_MAX_PLAYS)
        .sort((x, y) => y.last_played.localeCompare(x.last_played))
        .slice(0, 30)
        .map(toStat),
    };
  } finally {
    db.close();
  }
}
