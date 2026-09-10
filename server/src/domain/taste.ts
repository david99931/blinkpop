/**
 * ONE taste profile, merged across every linked account.
 *
 * Deliberately not per-provider. SoundCloud and Spotify describe the same
 * person from different angles and the useful signal is in the union, not in
 * either column:
 *
 *   - Spotify's genre vocabulary is rich and well-curated but its catalogue is
 *     commercial, so it says nothing about the underground where this game
 *     actually lives.
 *   - SoundCloud covers exactly that underground, with real play counts, but
 *     its genre tags are free-text and messy.
 *   - **Agreement between them is the strongest signal we have.** A genre both
 *     sources report is far more likely to be real taste than a tag that
 *     appeared once, so overlap is boosted rather than merely deduplicated.
 *
 * Everything carries provenance, so the UI can say "you play this on both" and
 * so a profile degrades gracefully when only one account is linked.
 */

import { listLinks, type LinkProvider } from "./linked-accounts.ts";
import { soundcloudAccessToken, spotifyAccessToken } from "./provider-tokens.ts";
import { scUserGet, type ScTrack } from "../providers/soundcloud.ts";
import { topArtists, topTracks, type SpArtist, type SpTrack, type TimeRange } from "../providers/spotify.ts";

export interface TasteGenre {
  genre: string;
  weight: number;
  /** Which linked accounts contributed. Two sources beats one. */
  sources: LinkProvider[];
}

export interface TasteArtist {
  name: string;
  sources: LinkProvider[];
  genres: string[];
  imageUrl: string | null;
}

export interface TasteTrack {
  title: string;
  artistName: string;
  source: LinkProvider;
  imageUrl: string | null;
  /** SoundCloud only — Spotify exposes no play counts at all. */
  plays: number | null;
}

export interface TasteProfile {
  linked: LinkProvider[];
  genres: TasteGenre[];
  artists: TasteArtist[];
  tracks: TasteTrack[];
  /** Artists both accounts agree on — the highest-confidence slice. */
  overlapArtists: string[];
}

/**
 * Normalise a genre so the two vocabularies can meet.
 *
 * Spotify emits hyper-specific lowercase phrases ("uk dance", "future garage");
 * SoundCloud emits free-text tags with arbitrary case, quotes and punctuation.
 * Without this they never merge and the overlap boost never fires.
 */
export function normaliseGenre(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/[_/]+/g, " ")
    // Spaced, and BEFORE the whitespace collapse — otherwise "R&B" becomes
    // "randb" and never meets "R and B" from the other source.
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
}

/** SoundCloud crams multiple tags into one space-separated, quote-delimited string. */
export function parseTagList(tagList: string | null | undefined): string[] {
  if (!tagList) return [];
  const out: string[] = [];
  // Quoted runs are single multi-word tags; bare runs are one tag each.
  const re = /"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tagList)) !== null) out.push(m[1] ?? m[2] ?? "");
  return out.filter(Boolean);
}

/** Harmonic decay — the #1 artist should count far more than the #50. */
const rankWeight = (i: number): number => 1 / (i + 1);

/**
 * Agreement across platforms is the strongest signal we have, and it should keep
 * getting stronger as more are linked — a genre confirmed by three catalogues
 * beats one confirmed by two. Scales with the number of AGREEING sources rather
 * than being a yes/no flag, so adding Apple Music deepens the signal instead of
 * flattening into the same bonus.
 */
const PER_EXTRA_SOURCE = 0.75;
const agreementBoost = (sources: number): number => 1 + Math.max(0, sources - 1) * PER_EXTRA_SOURCE;

interface Accumulator {
  genres: Map<string, { weight: number; sources: Set<LinkProvider> }>;
  artists: Map<string, { name: string; sources: Set<LinkProvider>; genres: Set<string>; imageUrl: string | null }>;
  tracks: TasteTrack[];
}

function addGenre(acc: Accumulator, raw: string, weight: number, source: LinkProvider): void {
  const genre = normaliseGenre(raw);
  if (!genre || genre.length < 2) return;
  const cur = acc.genres.get(genre) ?? { weight: 0, sources: new Set<LinkProvider>() };
  cur.weight += weight;
  cur.sources.add(source);
  acc.genres.set(genre, cur);
}

function addArtist(
  acc: Accumulator,
  name: string,
  source: LinkProvider,
  genres: string[],
  imageUrl: string | null,
): void {
  const key = name.trim().toLowerCase();
  if (!key) return;
  const cur = acc.artists.get(key) ?? { name: name.trim(), sources: new Set<LinkProvider>(), genres: new Set<string>(), imageUrl: null };
  cur.sources.add(source);
  for (const g of genres) cur.genres.add(normaliseGenre(g));
  cur.imageUrl = cur.imageUrl ?? imageUrl;
  acc.artists.set(key, cur);
}

async function ingestSpotify(acc: Accumulator, userId: number, range: TimeRange): Promise<boolean> {
  const token = await spotifyAccessToken(userId);
  if (!token) return false;
  const [artists, tracks] = await Promise.all([topArtists(token, range), topTracks(token, range)]);

  artists.items.forEach((a: SpArtist, i) => {
    const w = rankWeight(i);
    addArtist(acc, a.name, "spotify", a.genres ?? [], a.images?.[0]?.url ?? null);
    for (const g of a.genres ?? []) addGenre(acc, g, w, "spotify");
  });
  tracks.items.slice(0, 20).forEach((t: SpTrack) => {
    acc.tracks.push({
      title: t.name,
      artistName: t.artists.map((x) => x.name).join(", "),
      source: "spotify",
      imageUrl: t.album?.images?.[0]?.url ?? null,
      plays: null, // Spotify has no play counts, by design of their API
    });
  });
  return true;
}

async function ingestSoundCloud(acc: Accumulator, userId: number): Promise<boolean> {
  const token = await soundcloudAccessToken(userId);
  if (!token) return false;
  const raw = await scUserGet<ScTrack[] | { collection: ScTrack[] }>(
    "/me/likes/tracks?limit=50&linked_partitioning=false",
    token,
  );
  const liked = Array.isArray(raw) ? raw : (raw.collection ?? []);

  liked.forEach((t, i) => {
    const w = rankWeight(i);
    const tags = [t.genre ?? "", ...parseTagList(t.tag_list)].filter(Boolean);
    const artistName = t.user?.username ?? "Unknown artist";
    addArtist(acc, artistName, "soundcloud", tags, t.artwork_url ?? t.user?.avatar_url ?? null);
    for (const g of tags) addGenre(acc, g, w, "soundcloud");
    acc.tracks.push({
      title: t.title,
      artistName,
      source: "soundcloud",
      imageUrl: t.artwork_url ?? null,
      plays: typeof t.playback_count === "number" ? t.playback_count : null,
    });
  });
  return true;
}

/**
 * Build the merged profile. Sources are ingested in parallel and a failure in
 * one never sinks the other — a broken SoundCloud token still leaves a usable
 * Spotify-only profile rather than an error page.
 */
export async function buildTasteProfile(
  userId: number,
  range: TimeRange = "medium_term",
): Promise<TasteProfile> {
  const acc: Accumulator = { genres: new Map(), artists: new Map(), tracks: [] };
  const links = new Set(listLinks(userId).map((l) => l.provider));

  // Registry-driven, not positional: a new platform is one entry here and the
  // rest of this function never changes. allSettled so one broken token can
  // never sink the others — a dead SoundCloud link still yields a usable
  // Spotify-only profile rather than an error page.
  const sources: { provider: LinkProvider; ingest: () => Promise<boolean> }[] = [
    { provider: "spotify", ingest: () => ingestSpotify(acc, userId, range) },
    { provider: "soundcloud", ingest: () => ingestSoundCloud(acc, userId) },
  ];

  const active = sources.filter((s) => links.has(s.provider));
  const settled = await Promise.allSettled(active.map((s) => s.ingest()));
  const linked: LinkProvider[] = active
    .filter((_, i) => {
      const r = settled[i]!;
      return r.status === "fulfilled" && r.value;
    })
    .map((s) => s.provider);

  const genres: TasteGenre[] = [...acc.genres]
    .map(([genre, v]) => ({
      genre,
      // The boost is the whole point of merging: agreement across two very
      // different catalogues is much stronger evidence than volume within one.
      weight: Number((v.weight * agreementBoost(v.sources.size)).toFixed(4)),
      sources: [...v.sources],
    }))
    .sort((a, b) => b.weight - a.weight);

  const artists: TasteArtist[] = [...acc.artists.values()]
    .map((a) => ({ name: a.name, sources: [...a.sources], genres: [...a.genres], imageUrl: a.imageUrl }))
    .sort((a, b) => b.sources.length - a.sources.length || a.name.localeCompare(b.name));

  return {
    linked,
    genres,
    artists,
    tracks: acc.tracks,
    overlapArtists: artists.filter((a) => a.sources.length > 1).map((a) => a.name),
  };
}
