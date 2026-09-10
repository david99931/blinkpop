/**
 * Discovery — find real SoundCloud tracks inside a listener's target band.
 *
 * A script first, deliberately, so the algorithm can be judged against real
 * results before it becomes a screen. The same shape moves into the app once
 * the candidates look worth picking.
 *
 * The load-bearing technique, learned building the corpus: SoundCloud's search
 * ranks by popularity, so it cannot reach the VERY small end — asking for
 * "dubstep" gets the same million-play tracks every time. Genuinely obscure
 * tracks are only reachable by finding an artist and walking their CATALOGUE,
 * where the album cuts, remixes and B-sides live.
 *
 * For a mid band (tens of thousands of plays) search does contribute directly.
 * The lower a user's band goes, the more the catalogue walk carries the work —
 * which is exactly the direction the band moves as someone engages.
 *
 * So this runs in two passes:
 *   1. seed artists → their catalogues → tracks inside the band
 *   2. genre search  → the artists it surfaces → their catalogues too
 *
 * Pass 2 exists because pass 1 can only reach artists the user already knows.
 * Its search results are used as an ARTIST DISCOVERY mechanism, not as
 * candidates — the tracks it returns directly are exactly the big ones we don't
 * want.
 *
 *   npm run discover [userId] [limit]
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listenerProfile, REACH_MODES, type ReachMode } from "../src/domain/listener-profile.ts";
import { buildTasteProfile } from "../src/domain/taste.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAUSE_MS = 220;

try {
  const raw = readFileSync(path.join(HERE, "..", ".env"), "utf8").replace(/^﻿/, "");
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m && !line.trimStart().startsWith("#") && process.env[m[1]!] === undefined) {
      process.env[m[1]!] = m[2]!.trim().replace(/^["'](.*)["']$/, "$1");
    }
  }
} catch { /* handled below */ }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ScTrack {
  id: number; title?: string; genre?: string | null; tag_list?: string | null;
  playback_count?: number | null; favoritings_count?: number | null;
  created_at?: string | null; permalink_url?: string | null;
  user?: { id: number; username?: string } | null;
}

async function token(): Promise<string> {
  const id = process.env.SOUNDCLOUD_CLIENT_ID;
  const secret = process.env.SOUNDCLOUD_CLIENT_SECRET;
  if (!id || !secret) throw new Error("server/.env needs SOUNDCLOUD_CLIENT_ID and _SECRET");
  const res = await fetch("https://secure.soundcloud.com/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`token exchange failed: HTTP ${res.status}`);
  return (await res.json()).access_token;
}

let calls = 0;
async function scGet<T>(url: string, tok: string): Promise<T | null> {
  calls++;
  try {
    const res = await fetch(url, { headers: { Authorization: `OAuth ${tok}`, Accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const asList = (v: unknown): ScTrack[] =>
  Array.isArray(v) ? (v as ScTrack[]) : ((v as { collection?: ScTrack[] })?.collection ?? []);

interface Candidate {
  id: string; title: string; artist: string; plays: number; likes: number;
  genre: string | null; createdAt: string | null; url: string | null;
  via: string;
}

const userId = Number(process.argv[2] || 1);
const LIMIT = Number(process.argv[3] || 40);
const reachArg = process.argv[4] ?? "balanced";
if (!(REACH_MODES as readonly string[]).includes(reachArg)) {
  console.log(`reach must be one of: ${REACH_MODES.join(", ")}`);
  process.exit(1);
}
const reach = reachArg as ReachMode;

const profile = await listenerProfile(userId, reach);
const taste = await buildTasteProfile(userId);

console.log(`listener: ${profile.label}`);
console.log(`reach   : ${reach}`);
console.log(`band    : ${profile.targetBand.min.toLocaleString()} – ${profile.targetBand.max.toLocaleString()} plays`);
console.log(`why     : ${profile.reasoning}\n`);

const tok = await token();
const seen = new Set<string>();
const candidates: Candidate[] = [];
const { min, max } = profile.targetBand;

/** Keep only tracks inside the band, and never one the user already likes. */
const consider = (t: ScTrack, via: string): void => {
  const plays = t.playback_count;
  if (typeof plays !== "number" || plays < min || plays > max) return;
  const id = String(t.id);
  if (seen.has(id)) return;
  seen.add(id);
  candidates.push({
    id,
    title: t.title ?? "(untitled)",
    artist: t.user?.username ?? "Unknown",
    plays,
    likes: typeof t.favoritings_count === "number" ? t.favoritings_count : 0,
    genre: t.genre ?? null,
    createdAt: t.created_at ?? null,
    url: t.permalink_url ?? null,
    via,
  });
};

// Tracks the user already likes are not discoveries.
const known = new Set(
  taste.tracks.filter((t) => t.source === "soundcloud").map((t) => `${t.artistName}|${t.title}`),
);

// ── pass 1: the artists they already dig, walked properly ──
const seedNames = taste.artists
  .filter((a) => a.sources.includes("soundcloud"))
  .map((a) => a.name)
  .slice(0, 12);

console.log(`pass 1 — catalogues of ${seedNames.length} artists you already like`);
for (const name of seedNames) {
  const users = await scGet<unknown>(
    `https://api.soundcloud.com/users?q=${encodeURIComponent(name)}&limit=1`,
    tok,
  );
  const uid = (Array.isArray(users) ? users[0] : null)?.id;
  if (!uid) continue;
  const list = asList(await scGet(`https://api.soundcloud.com/users/${uid}/tracks?limit=50`, tok));
  for (const t of list) {
    if (known.has(`${t.user?.username}|${t.title}`)) continue;
    consider(t, `catalogue:${name}`);
  }
  process.stdout.write(`  ${name.slice(0, 24).padEnd(24)} candidates=${candidates.length}\r`);
  await sleep(PAUSE_MS);
}
console.log(`\n  → ${candidates.length} in band\n`);

// ── pass 2: reach artists they DON'T know, via their genres ──
// Search results themselves are the popular tracks we are trying to avoid, so
// they are mined for ARTIST IDS and discarded.
const genres = taste.genres.slice(0, 8).map((g) => g.genre);
console.log(`pass 2 — genre search as artist discovery: ${genres.join(", ")}`);
const newArtists = new Map<string, string>();
for (const g of genres) {
  const list = asList(
    await scGet(`https://api.soundcloud.com/tracks?q=${encodeURIComponent(g)}&limit=50&access=playable`, tok),
  );
  for (const t of list) {
    if (t.user?.id != null && !seedNames.includes(t.user.username ?? "")) {
      newArtists.set(String(t.user.id), t.user.username ?? "?");
    }
    consider(t, `search:${g}`); // occasionally one lands in band anyway
  }
  await sleep(PAUSE_MS);
}
console.log(`  found ${newArtists.size} artists not already in your taste`);

// Capped by API CALLS, not by candidate count. Capping on candidates meant the
// search pass filled the quota first and this loop — the only one that reaches
// artists the user has never heard of — was skipped entirely.
const WALK_ARTISTS = 25;
let walked = 0;
for (const [uid, name] of newArtists) {
  if (walked >= WALK_ARTISTS) break;
  const list = asList(await scGet(`https://api.soundcloud.com/users/${uid}/tracks?limit=50`, tok));
  for (const t of list) consider(t, `new:${name}`);
  walked++;
  process.stdout.write(`  walked ${walked}/${Math.min(25, newArtists.size)}  candidates=${candidates.length}\r`);
  await sleep(PAUSE_MS);
}

// ── rank ──
// Engagement per play, not raw plays: inside a fixed band the bigger track is
// not the better call, but a track people are actually saving is.
//
// SMOOTHED, because the raw ratio is badly behaved at the small end — a track
// with 672 plays and 227 likes shows 33.8%, which is far more likely to be the
// artist's friends than a signal about the music. Adding a prior to the
// denominator pulls low-sample tracks toward the middle while barely touching
// tracks big enough to have earned their ratio: that 672-play track drops to
// 13.6%, while a 30,000-play track at 15% stays at 14.5%.
const ENGAGEMENT_PRIOR = 1_000;
const scored = candidates
  .map((c) => ({
    ...c,
    engagement: c.likes / (c.plays + ENGAGEMENT_PRIOR),
    rawEngagement: c.likes / Math.max(1, c.plays),
  }))
  .sort((a, b) => b.engagement - a.engagement)
  .slice(0, LIMIT);

console.log(`\n\n${"=".repeat(78)}`);
console.log(`${scored.length} CANDIDATES — ranked by likes per play`);
console.log(`${"=".repeat(78)}`);
for (const c of scored) {
  console.log(
    `  ${c.plays.toLocaleString().padStart(9)} plays  ${(c.engagement * 100).toFixed(1).padStart(5)}% liked  ` +
      `(raw ${(c.rawEngagement * 100).toFixed(0)}%)  ` +
      `${c.title.slice(0, 30).padEnd(30)} ${c.artist.slice(0, 16).padEnd(16)} ${c.via.slice(0, 20)}`,
  );
}

const bands: [number, number, string][] = [
  [0, 1e3, "<1k"], [1e3, 1e4, "1k–10k"], [1e4, 1e5, "10k–100k"], [1e5, 1e6, "100k–1M"],
];
console.log(`\nsize mix of all ${candidates.length} in-band candidates:`);
for (const [lo, hi, label] of bands) {
  const n = candidates.filter((c) => c.plays >= lo && c.plays < hi).length;
  if (n) console.log(`  ${label.padEnd(9)} ${String(n).padStart(4)}`);
}
const viaCounts = new Map<string, number>();
for (const c of candidates) {
  const kind = c.via.split(":")[0]!;
  viaCounts.set(kind, (viaCounts.get(kind) ?? 0) + 1);
}
console.log(`\nwhere they came from:`);
for (const [k, v] of viaCounts) console.log(`  ${k.padEnd(10)} ${String(v).padStart(4)}`);
console.log(`\nSoundCloud API calls: ${calls}`);
