/**
 * Discovery — real SoundCloud tracks inside a listener's target band.
 *
 * Three passes, and the order matters:
 *   1. catalogues of artists the user already likes
 *   2. genre search (contributes directly at a mid band)
 *   3. the ARTISTS those searches surface, catalogues walked
 *
 * Pass 3 is the only one that reaches artists the user has never heard of, and
 * SoundCloud's search ranks by popularity so it cannot reach the very small end
 * at all. The lower the band goes, the more pass 3 carries — at Uncharted it
 * does essentially all the work.
 *
 * ⚠ Bootlegs, edits, remixes and slowed+reverb flips are GOOD PICKS in EDM, not
 * noise. The bootleg circuit is where underground tracks actually break. Never
 * filter or deprioritise them.
 *
 * A full run costs ~57 API calls and 20–30s, so results are CACHED per
 * (user, reach) and refreshing is an explicit act, never a side effect of
 * loading a page.
 */

import { getDb } from "../db/db.ts";
import { soundcloudAccessToken } from "./provider-tokens.ts";
import { soundCloudConfigFromEnv } from "../providers/soundcloud.ts";
import { listenerProfile, type ReachMode } from "./listener-profile.ts";
import { buildTasteProfile } from "./taste.ts";

const PAUSE_MS = 180;
const WALK_ARTISTS = 25;
const SEED_ARTISTS = 12;
const SEARCH_GENRES = 8;

/**
 * Smoothing prior for likes-per-play.
 *
 * The raw ratio is unusable at the small end: 672 plays with 227 likes reads
 * 33.8%, which is the artist's friends rather than a signal about the music.
 * A prior in the denominator pulls low-sample tracks toward the middle while
 * barely touching tracks big enough to have earned their ratio.
 */
const ENGAGEMENT_PRIOR = 1_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ScTrack {
  id: number; title?: string; genre?: string | null;
  playback_count?: number | null; favoritings_count?: number | null;
  created_at?: string | null; permalink_url?: string | null; artwork_url?: string | null;
  user?: { id: number; username?: string; avatar_url?: string | null } | null;
}

export interface DiscoveryCandidate {
  providerTrackId: string;
  title: string;
  artistName: string;
  plays: number;
  likes: number;
  genre: string | null;
  permalinkUrl: string | null;
  artworkUrl: string | null;
  createdAt: string | null;
  via: string;
  score: number;
}

export interface DiscoveryResult {
  reach: ReachMode;
  band: { min: number; max: number };
  computedAt: string | null;
  apiCalls: number;
  candidates: DiscoveryCandidate[];
  /** Which pass found what — tells us which calls are earning their keep. */
  provenance: { source: string; count: number }[];
}

const asList = (v: unknown): ScTrack[] =>
  Array.isArray(v) ? (v as ScTrack[]) : ((v as { collection?: ScTrack[] })?.collection ?? []);

/**
 * App-level credentials, not the user's.
 *
 * Catalogue walking hits public endpoints that need no user context, and using
 * the app token means discovery keeps working when someone's personal token has
 * expired — which would otherwise silently empty the page.
 */
async function appToken(): Promise<string | null> {
  const config = soundCloudConfigFromEnv();
  if (!config) return null;
  const res = await fetch("https://secure.soundcloud.com/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) return null;
  return (await res.json()).access_token as string;
}

/** Read whatever was last computed. Never hits the network. */
export function cachedDiscovery(userId: number, reach: ReachMode): DiscoveryResult | null {
  const db = getDb();
  const run = db
    .prepare("SELECT computed_at, band_min, band_max, api_calls FROM discovery_runs WHERE user_id = ? AND reach = ?")
    .get(userId, reach) as
    | { computed_at: string; band_min: number; band_max: number; api_calls: number }
    | undefined;
  if (!run) return null;

  const rows = db
    .prepare(
      `SELECT provider_track_id, title, artist_name, plays, likes, genre,
              permalink_url, artwork_url, created_at, via, score
         FROM discovery_candidates WHERE user_id = ? AND reach = ?
        ORDER BY score DESC`,
    )
    .all(userId, reach) as unknown as Record<string, never>[];

  const candidates = rows.map((r: any) => ({
    providerTrackId: r.provider_track_id,
    title: r.title,
    artistName: r.artist_name,
    plays: r.plays,
    likes: r.likes,
    genre: r.genre,
    permalinkUrl: r.permalink_url,
    artworkUrl: r.artwork_url,
    createdAt: r.created_at,
    via: r.via,
    score: r.score,
  }));

  const counts = new Map<string, number>();
  for (const c of candidates) {
    const kind = c.via.split(":")[0]!;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }

  return {
    reach,
    band: { min: run.band_min, max: run.band_max },
    computedAt: run.computed_at,
    apiCalls: run.api_calls,
    candidates,
    provenance: [...counts].map(([source, count]) => ({ source, count })),
  };
}

/** Run the three passes and replace the cache for this (user, reach). */
export async function refreshDiscovery(userId: number, reach: ReachMode): Promise<DiscoveryResult> {
  const profile = await listenerProfile(userId, reach);
  const taste = await buildTasteProfile(userId);
  const { min, max } = profile.targetBand;

  const tok = (await appToken()) ?? (await soundcloudAccessToken(userId));
  if (!tok) throw new Error("soundcloud not configured");

  let calls = 0;
  const get = async <T>(url: string): Promise<T | null> => {
    calls++;
    try {
      const res = await fetch(url, { headers: { Authorization: `OAuth ${tok}`, Accept: "application/json" } });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  };

  const seen = new Set<string>();
  const found: DiscoveryCandidate[] = [];
  // Tracks already in their likes are not discoveries.
  const known = new Set(
    taste.tracks.filter((t) => t.source === "soundcloud").map((t) => `${t.artistName}|${t.title}`),
  );

  const consider = (t: ScTrack, via: string): void => {
    const plays = t.playback_count;
    if (typeof plays !== "number" || plays < min || plays > max) return;
    const id = String(t.id);
    if (seen.has(id)) return;
    if (known.has(`${t.user?.username}|${t.title}`)) return;
    seen.add(id);
    const likes = typeof t.favoritings_count === "number" ? t.favoritings_count : 0;
    found.push({
      providerTrackId: id,
      title: t.title ?? "(untitled)",
      artistName: t.user?.username ?? "Unknown",
      plays,
      likes,
      genre: t.genre ?? null,
      permalinkUrl: t.permalink_url ?? null,
      artworkUrl: t.artwork_url ?? t.user?.avatar_url ?? null,
      createdAt: t.created_at ?? null,
      via,
      score: likes / (plays + ENGAGEMENT_PRIOR),
    });
  };

  // ── pass 1: artists they already dig ──
  const seedNames = taste.artists
    .filter((a) => a.sources.includes("soundcloud"))
    .map((a) => a.name)
    .slice(0, SEED_ARTISTS);
  for (const name of seedNames) {
    const users = await get<{ id: number }[]>(
      `https://api.soundcloud.com/users?q=${encodeURIComponent(name)}&limit=1`,
    );
    const uid = Array.isArray(users) ? users[0]?.id : undefined;
    if (!uid) continue;
    for (const t of asList(await get(`https://api.soundcloud.com/users/${uid}/tracks?limit=50`))) {
      consider(t, `catalogue:${name}`);
    }
    await sleep(PAUSE_MS);
  }

  // ── pass 2: genre search, also mined for artists ──
  const newArtists = new Map<string, string>();
  for (const g of taste.genres.slice(0, SEARCH_GENRES).map((x) => x.genre)) {
    const list = asList(
      await get(`https://api.soundcloud.com/tracks?q=${encodeURIComponent(g)}&limit=50&access=playable`),
    );
    for (const t of list) {
      if (t.user?.id != null && !seedNames.includes(t.user.username ?? "")) {
        newArtists.set(String(t.user.id), t.user.username ?? "?");
      }
      consider(t, `search:${g}`);
    }
    await sleep(PAUSE_MS);
  }

  // ── pass 3: walk the new artists. Capped by CALLS, not by candidates found —
  // capping on the latter let pass 2 fill the quota and skip this entirely. ──
  let walked = 0;
  for (const [uid, name] of newArtists) {
    if (walked >= WALK_ARTISTS) break;
    for (const t of asList(await get(`https://api.soundcloud.com/users/${uid}/tracks?limit=50`))) {
      consider(t, `new:${name}`);
    }
    walked++;
    await sleep(PAUSE_MS);
  }

  found.sort((a, b) => b.score - a.score);

  const db = getDb();
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM discovery_candidates WHERE user_id = ? AND reach = ?").run(userId, reach);
    const ins = db.prepare(
      "INSERT INTO discovery_candidates VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    for (const c of found) {
      ins.run(
        userId, reach, c.providerTrackId, c.title, c.artistName, c.plays, c.likes,
        c.genre, c.permalinkUrl, c.artworkUrl, c.createdAt, c.via, c.score,
      );
    }
    db.prepare(
      "INSERT INTO discovery_runs VALUES (?,?,?,?,?,?) ON CONFLICT(user_id, reach) DO UPDATE SET " +
        "computed_at=excluded.computed_at, band_min=excluded.band_min, " +
        "band_max=excluded.band_max, api_calls=excluded.api_calls",
    ).run(userId, reach, now, min, max, calls);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return cachedDiscovery(userId, reach)!;
}
