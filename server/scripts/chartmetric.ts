/**
 * Chartmetric probe — can we buy our way out of waiting 90 days for the corpus?
 *
 * The corpus can only measure trajectory shape by watching tracks over elapsed
 * time. Chartmetric sells history directly, so if it covers our tracks we get
 * the calibration data NOW. The open question is not whether the API works —
 * it's whether Chartmetric can SEE the tracks we care about. Its SoundCloud
 * index is ~111k artists; our corpus deliberately walked artist catalogues to
 * reach small tracks, which is exactly the population an analytics vendor has
 * least reason to index.
 *
 * So this probe reports coverage BY PLAY-COUNT BUCKET rather than overall. A
 * flat 60% hit rate would be useless to interpret; "94% above 1M, 0% below 1k"
 * tells us precisely which badges Chartmetric can and cannot calibrate.
 *
 * Response shapes are NOT assumed — the first response of each kind is dumped
 * so we read the real field names off the wire instead of guessing them.
 *
 *   npm run cm:probe        # 20 tracks, 4 per bucket
 *   npm run cm:probe 50     # wider, more credits
 */

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { badgeName, classifyByAffinity, trajectorySignals } from "../src/scoring/badges.ts";
import { AFFINITY } from "@firstfan/shared";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.CORPUS_DB ?? path.join(HERE, "..", "firstfan-corpus.db");
const API = "https://api.chartmetric.com/api";
const PAUSE_MS = 1100; // entry API plans are documented at 1 request/sec
const HISTORY_DAYS = 180;
/** A cached series stays usable this long, so a moving date key cannot re-bill us. */
const CACHE_FRESH_DAYS = 30;
const USD_PER_CREDIT = 0.01;
/** Hard stop. Real money — the script aborts rather than overrunning this. */
const DEFAULT_BUDGET = 60;

// ── env (BOM-tolerant; PowerShell's Set-Content writes one) ──
try {
  const raw = readFileSync(path.join(HERE, "..", ".env"), "utf8").replace(/^﻿/, "");
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m && !line.trimStart().startsWith("#") && process.env[m[1]!] === undefined) {
      process.env[m[1]!] = m[2]!.trim().replace(/^["'](.*)["']$/, "$1");
    }
  }
} catch { /* no .env — auth below will explain */ }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Buckets mirror the corpus seed mix so coverage lines up with what we sampled. */
const BUCKETS: { label: string; min: number; max: number }[] = [
  { label: "<1k", min: 0, max: 1_000 },
  { label: "1k–10k", min: 1_000, max: 10_000 },
  { label: "10k–100k", min: 10_000, max: 100_000 },
  { label: "100k–1M", min: 100_000, max: 1_000_000 },
  { label: "1M+", min: 1_000_000, max: Number.MAX_SAFE_INTEGER },
];

let calls = 0;
let budget = DEFAULT_BUDGET;
let lastRateHeaders = "";

class BudgetExhausted extends Error {}

/**
 * Nothing hits the network without passing through here. Credits cost real
 * money and a bug in a loop is the expensive kind, so the cap is enforced at
 * the one choke point rather than trusted to each caller.
 */
function spend(): void {
  if (calls >= budget) {
    throw new BudgetExhausted(`budget of ${budget} credits reached — stopping before overspend`);
  }
  calls++;
}

// ── caches: resolution and history are permanent facts, never buy them twice ──
const cache = new DatabaseSync(DB_PATH);
cache.exec("PRAGMA journal_mode = WAL;");
cache.exec(`
  CREATE TABLE IF NOT EXISTS cm_resolution (
    provider_track_id TEXT PRIMARY KEY,
    cm_track_id       INTEGER,          -- NULL means CONFIRMED absent, not unknown
    cm_name           TEXT,
    resolved_at       TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cm_history (
    cm_track_id  INTEGER NOT NULL,
    platform     TEXT NOT NULL,
    since        TEXT NOT NULL,
    payload      TEXT NOT NULL,
    fetched_at   TEXT NOT NULL,
    PRIMARY KEY (cm_track_id, platform, since)
  );
`);

async function token(): Promise<string> {
  const refresh = process.env.CHARTMETRIC_REFRESH_TOKEN;
  if (!refresh) {
    throw new Error(
      "server/.env needs CHARTMETRIC_REFRESH_TOKEN=<your refresh token>\n" +
        "Get it from platform.chartmetric.com (or hi@chartmetric.com). Never commit it.",
    );
  }
  spend();
  const res = await fetch(`${API}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshtoken: refresh }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`token exchange failed: HTTP ${res.status} ${body.slice(0, 300)}`);
  const json = JSON.parse(body);
  const tok = json.token ?? json.access_token;
  if (!tok) throw new Error(`no token in response: ${body.slice(0, 300)}`);
  console.log(`auth ok — token expires in ${json.expires_in ?? "?"}s`);
  return tok;
}

interface CmResult { ok: boolean; status: number; json: any; text: string }

async function cmGet(tok: string, pathAndQuery: string): Promise<CmResult> {
  spend();
  const res = await fetch(`${API}${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${tok}`, Accept: "application/json" },
  });
  // Credit/quota accounting is undocumented publicly — capture whatever the
  // response advertises so we can price a full backfill from real headers.
  const interesting = [...res.headers.entries()].filter(([k]) =>
    /ratelimit|credit|quota|usage|remaining/i.test(k),
  );
  if (interesting.length) lastRateHeaders = interesting.map(([k, v]) => `${k}=${v}`).join("  ");
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error page */ }
  await sleep(PAUSE_MS);
  return { ok: res.ok, status: res.status, json, text };
}

/** Chartmetric wraps most payloads in `obj`; tolerate both without assuming. */
const unwrap = (j: any) => (j && typeof j === "object" && "obj" in j ? j.obj : j);

let dumpedSearch = false;
let dumpedStats = false;

function dumpShape(label: string, value: any): void {
  console.log(`\n── raw ${label} shape (first response only) ──`);
  const seen = JSON.stringify(value, null, 2) ?? String(value);
  console.log(seen.length > 1800 ? seen.slice(0, 1800) + "\n… truncated" : seen);
  console.log("──\n");
}

interface Row { provider_track_id: string; title: string; artist_name: string | null; plays: number }

function sample(perBucket: number): { bucket: string; rows: Row[] }[] {
  const db = new DatabaseSync(DB_PATH);
  // Latest known play count per track, so bucketing reflects current size.
  const stmt = db.prepare(`
    SELECT t.provider_track_id, t.title, t.artist_name, s.plays
      FROM corpus_tracks t
      JOIN corpus_snapshots s ON s.id = (
        SELECT id FROM corpus_snapshots
         WHERE provider_track_id = t.provider_track_id
         ORDER BY captured_at DESC LIMIT 1
      )
     WHERE s.plays >= ? AND s.plays < ?
     ORDER BY t.provider_track_id
     LIMIT ?`);
  const out = BUCKETS.map((b) => ({
    bucket: b.label,
    rows: stmt.all(b.min, b.max, perBucket) as unknown as Row[],
  }));
  db.close();
  return out;
}

/** Find a Chartmetric track id for a SoundCloud track, by name + artist. */
async function resolve(tok: string, row: Row): Promise<{ id: number | null; name?: string; cached?: boolean }> {
  const hit0 = cache
    .prepare("SELECT cm_track_id, cm_name FROM cm_resolution WHERE provider_track_id = ?")
    .get(row.provider_track_id) as { cm_track_id: number | null; cm_name: string | null } | undefined;
  if (hit0) return { id: hit0.cm_track_id, name: hit0.cm_name ?? undefined, cached: true };

  const q = [row.title, row.artist_name].filter(Boolean).join(" ").slice(0, 120);
  const r = await cmGet(tok, `/search?q=${encodeURIComponent(q)}&type=tracks&limit=5`);
  if (!r.ok) return { id: null };
  if (!dumpedSearch) { dumpShape("search", r.json); dumpedSearch = true; }

  const o = unwrap(r.json);
  // Shape is discovered, not assumed: walk for the first array of objects
  // carrying an id, whatever the wrapper key turns out to be.
  const arr: any[] = Array.isArray(o) ? o
    : Array.isArray(o?.tracks) ? o.tracks
    : Object.values(o ?? {}).find((v) => Array.isArray(v) && v.length && typeof v[0] === "object") as any[] ?? [];
  const hit = arr.find((t) => t && (typeof t.id === "number" || typeof t.cm_track === "number"));
  const id: number | null = hit ? (hit.id ?? hit.cm_track) : null;
  const name: string | null = hit ? (hit.name ?? hit.title ?? null) : null;
  // A miss is recorded too — "Chartmetric does not have this track" is exactly
  // the finding we are paying for, and re-asking would cost again.
  cache
    .prepare("INSERT OR REPLACE INTO cm_resolution VALUES (?, ?, ?, ?)")
    .run(row.provider_track_id, id, name, new Date().toISOString());
  return { id, name: name ?? undefined };
}

/** Pull the time series and report how much real history came back. */
async function history(tok: string, cmId: number, platform: string) {
  const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const cached = cache
    .prepare("SELECT payload FROM cm_history WHERE cm_track_id = ? AND platform = ? AND since = ?")
    .get(cmId, platform, since) as { payload: string } | undefined;

  let json: any;
  if (cached) {
    json = JSON.parse(cached.payload);
  } else {
    const r = await cmGet(tok, `/track/${cmId}/${platform}/stats?since=${since}`);
    if (!r.ok) return { ok: false as const, status: r.status, note: r.text.slice(0, 160) };
    if (!dumpedStats) { dumpShape(`track stats (${platform})`, r.json); dumpedStats = true; }
    json = r.json;
    cache
      .prepare("INSERT OR REPLACE INTO cm_history VALUES (?, ?, ?, ?, ?)")
      .run(cmId, platform, since, JSON.stringify(json), new Date().toISOString());
  }

  const o = unwrap(json);
  const series: any[] = Array.isArray(o) ? o
    : Object.values(o ?? {}).find((v) => Array.isArray(v)) as any[] ?? [];
  const points = series.filter((p) => p && typeof p === "object");
  if (!points.length) return { ok: true as const, points: 0, span: 0, first: null, last: null };

  const val = (p: any) => p.value ?? p.plays ?? p.count ?? p.streams ?? null;
  const at = (p: any) => p.timestp ?? p.timestamp ?? p.date ?? p.time ?? null;
  const dates = points.map(at).filter(Boolean).sort();
  const span = dates.length > 1
    ? Math.round((Date.parse(dates[dates.length - 1]!) - Date.parse(dates[0]!)) / 86_400_000)
    : 0;
  return {
    ok: true as const,
    points: points.length,
    span,
    first: val(points[0]),
    last: val(points[points.length - 1]),
  };
}

async function probe(perBucket: number) {
  const tok = await token();
  const groups = sample(perBucket);
  const platforms = ["soundcloud", "spotify"];
  let workingPlatform: string | null = null;

  const summary: { bucket: string; tried: number; resolved: number; withHistory: number; spans: number[] }[] = [];
  let halted = false;

  outer:
  for (const g of groups) {
    const s = { bucket: g.bucket, tried: 0, resolved: 0, withHistory: 0, spans: [] as number[] };
    summary.push(s);
    console.log(`\n=== bucket ${g.bucket} (${g.rows.length} tracks) ===`);
    for (const row of g.rows) {
      if (calls >= budget) { halted = true; break outer; }
      s.tried++;
      const { id, name } = await resolve(tok, row);
      const label = `${row.title.slice(0, 42)} — ${row.plays.toLocaleString()} plays`;
      if (!id) { console.log(`  ✗ ${label}  (not in Chartmetric)`); continue; }
      s.resolved++;

      // Establish once which platform key this account can actually read.
      let h: Awaited<ReturnType<typeof history>> | null = null;
      for (const p of workingPlatform ? [workingPlatform] : platforms) {
        h = await history(tok, id, p);
        if (h.ok) { workingPlatform = p; break; }
        console.log(`    platform "${p}" → HTTP ${h.status} ${h.note ?? ""}`);
      }
      if (!h?.ok) { console.log(`  ~ ${label}  (found #${id}, no readable stats)`); continue; }
      if (h.points > 0) { s.withHistory++; s.spans.push(h.span); }
      console.log(
        `  ✓ ${label}\n      cm#${id} "${(name ?? "").slice(0, 40)}" · ${h.points} points over ${h.span}d` +
          (h.first != null ? ` · ${h.first} → ${h.last}` : ""),
      );
    }
  }
  if (halted) console.log(`\n⚠ stopped early: hit the ${budget}-credit budget.`);

  console.log(`\n${"=".repeat(64)}\nCOVERAGE BY SIZE — the decisive number\n${"=".repeat(64)}`);
  console.log("bucket        tried  found  w/history   median span");
  for (const s of summary) {
    const med = s.spans.length ? s.spans.slice().sort((a, b) => a - b)[Math.floor(s.spans.length / 2)]! : 0;
    const pct = s.tried ? Math.round((s.resolved / s.tried) * 100) : 0;
    console.log(
      `${s.bucket.padEnd(12)}  ${String(s.tried).padStart(5)}  ${String(s.resolved).padStart(5)} (${String(pct).padStart(3)}%)  ` +
        `${String(s.withHistory).padStart(6)}   ${String(med).padStart(8)}d`,
    );
  }
  console.log(`\nplatform that worked: ${workingPlatform ?? "none"}`);
  console.log(
    `credits spent this run: ${calls} of ${budget} budgeted ` +
      `(~$${(calls * USD_PER_CREDIT).toFixed(2)} at $${USD_PER_CREDIT}/credit)`,
  );
  console.log("resolutions and history are cached — re-running costs nothing for these tracks");
  if (lastRateHeaders) console.log(`quota headers: ${lastRateHeaders}`);
  console.log(
    "\nRead it this way: coverage in the TOP buckets calibrates Juggernaut.\n" +
      "Coverage in the BOTTOM buckets is the only thing that can calibrate\n" +
      "Moonshot — and Moonshot is the badge that is currently broken.",
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Spotify study — measure what a real 180-day run looks like.
//
// Chartmetric has no SoundCloud track history (see the probe findings), so it
// cannot calibrate our badges directly. What it CAN do is settle the question
// underneath Moonshot: how many doublings does a real track actually achieve
// in 180 days? Our 2.78 ceiling is PROJECTED from lifetime averages. This
// measures it on a second platform with real dated observations.
//
// Deliberately not sampled from charts — chart tracks are survivors, and a
// ceiling measured on winners is not a ceiling. /track/list/filter pages
// through the general catalogue instead.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Not an aggregation bucket, despite what the docs say — the API's own 400
 * names these two, and they select WHICH Spotify track variant to read (the
 * same song exists under several ids across singles and albums).
 * `most-history` wins: longest series, which is the whole point here.
 */
const MODE_CANDIDATES = ["most-history", "highest-playcounts"];

/**
 * Find the platform/mode/type triple this account can actually read.
 *
 * The docs enumerate none of them accurately — they called `mode` an
 * "aggregation bucket" and listed platforms as "spotify, youtube, tiktok,
 * etc.". But Chartmetric's 400s NAME the allowed values, so the cheapest
 * route to the truth is to send a wrong one and read the complaint.
 */
async function discoverEndpoint(
  tok: string,
  cmId: number,
  platforms: string[],
  types: string[],
): Promise<{ platform: string; mode: string; type: string } | null> {
  for (const platform of platforms) {
    for (const mode of MODE_CANDIDATES) {
      for (const type of types) {
        const r = await cmGet(tok, `/track/${cmId}/${platform}/stats/${mode}?type=${type}`);
        if (r.ok) {
          console.log(`  ${platform}/${mode}?type=${type} → OK`);
          return { platform, mode, type };
        }
        console.log(
          `  ${platform}/${mode}?type=${type} → HTTP ${r.status}  ` +
            r.text.slice(0, 200).replace(/\s+/g, " "),
        );
        // A 404 means the platform segment itself is unrouted — no point
        // cycling modes and types underneath it.
        if (r.status === 404) break;
      }
      if (calls >= budget - 2) return null;
    }
  }
  return null;
}

/** Points Chartmetric filled in are smoothing, not observation — they'd flatten burst. */
function realPoints(json: any): { plays: number; capturedAt: string }[] {
  const o = unwrap(json);
  const block = Array.isArray(o) ? o[0] : o;
  const data: any[] = block?.data ?? [];
  return data
    .filter((p) => p && p.interpolated !== true && p.value != null && (p.timestp ?? p.timestamp))
    .map((p) => ({ plays: Number(p.value), capturedAt: String(p.timestp ?? p.timestamp) }))
    .filter((p) => Number.isFinite(p.plays))
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

/** Platform aliases worth trying, most likely first. Apple Music is aliased to
 *  `itunes` elsewhere in the API, so try both rather than assume either. */
const PLATFORM_ALIASES: Record<string, string[]> = {
  spotify: ["spotify"],
  soundcloud: ["soundcloud"],
  // Apple Music is NOT a valid stats platform. The API's own 400 enumerates
  // [shazam, spotify, youtube, tiktok, genius, soundcloud, chartmetric, line,
  // melon, radio] — Apple Music appears only in playlist and chart endpoints.
  // Kept so the failure stays documented rather than being re-attempted.
  applemusic: ["applemusic", "itunes", "apple_music"],
};
const TYPE_CANDIDATES: Record<string, string[]> = {
  spotify: ["streams", "popularity"],
  soundcloud: ["plays", "streams"],
  applemusic: ["plays", "streams", "popularity"],
};

async function platformStudy(label: string, want: number) {
  const platforms = PLATFORM_ALIASES[label] ?? [label];
  const types = TYPE_CANDIDATES[label] ?? ["streams"];
  const tok = await token();

  // The default ordering is score-descending — a bare first page is Shakira and
  // friends, which is the same survivorship trap as sampling from charts. Walk
  // several deep offsets so the sample spans the popularity range instead.
  console.log("\n── sampling the general catalogue across offsets (not charts) ──");
  const OFFSETS = [0, 2000, 4000, 6000, 8000];
  const per = Math.max(1, Math.ceil(want / OFFSETS.length));
  const ids: number[] = [];
  let shaped = false;

  for (const off of OFFSETS) {
    const listed = await cmGet(tok, `/track/list/filter?limit=${per}&offset=${off}`);
    if (!listed.ok) {
      console.log(`  offset ${off} → HTTP ${listed.status} ${listed.text.slice(0, 160)}`);
      continue;
    }
    const lo = unwrap(listed.json);
    const rows: any[] = Array.isArray(lo) ? lo : (lo?.obj ?? lo?.data ?? []);
    if (!shaped && rows.length) { dumpShape("track/list/filter (one row)", rows[0]); shaped = true; }
    const got = rows
      .map((t) => t?.id ?? t?.cm_track)
      .filter((x): x is number => typeof x === "number");
    const scores = rows.map((t) => t?.score).filter((s) => typeof s === "number");
    console.log(
      `  offset ${String(off).padStart(4)} → ${got.length} tracks` +
        (scores.length ? `  (score ${Math.min(...scores).toFixed(0)}–${Math.max(...scores).toFixed(0)})` : ""),
    );
    ids.push(...got);
  }
  console.log(`got ${ids.length} track ids`);
  if (!ids.length) return;

  console.log(`\n── discovering the ${label} stats endpoint ──`);
  const ep = await discoverEndpoint(tok, ids[0]!, platforms, types);
  if (!ep) {
    console.log(`\nno readable ${label} stats endpoint — stopping before spending more`);
    console.log(`credits spent: ${calls} (~$${(calls * USD_PER_CREDIT).toFixed(2)})`);
    return;
  }

  const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  let noData = 0;

  console.log(`\n── pulling ${HISTORY_DAYS}d of ${ep.platform} ${ep.type} ──`);
  for (const id of ids) {
    if (calls >= budget - 1) { console.log("⚠ budget reached, stopping sample early"); break; }
    // NOT keyed on `since` — that is "today minus 180 days", so it moves every
    // day and an exact-match cache would silently re-buy the whole sample on
    // every later run. Any series fetched inside the freshness window will do.
    const fresh = new Date(Date.now() - CACHE_FRESH_DAYS * 86_400_000).toISOString();
    const cached = cache
      .prepare(
        "SELECT payload FROM cm_history WHERE cm_track_id = ? AND platform = ? " +
          "AND fetched_at >= ? ORDER BY fetched_at DESC LIMIT 1",
      )
      .get(id, ep.platform, fresh) as { payload: string } | undefined;

    let json: any;
    if (cached) {
      json = JSON.parse(cached.payload);
    } else {
      const r = await cmGet(
        tok,
        `/track/${id}/${ep.platform}/stats/${ep.mode}?type=${ep.type}&since=${since}`,
      );
      if (!r.ok) { noData++; continue; }
      json = r.json;
      // Persist the RAW series, not the derived numbers. Every threshold we
      // may want to check later is recomputable from this, for free.
      cache
        .prepare("INSERT OR REPLACE INTO cm_history VALUES (?, ?, ?, ?, ?)")
        .run(id, ep.platform, since, JSON.stringify(json), new Date().toISOString());
    }

    const pts = realPoints(json);
    if (pts.length < 2) { noData++; continue; }
  }
  console.log(`fetched/cached ${ids.length - noData} series  (no data: ${noData})`);
  report(ep.platform, since);
  console.log(
    `\ncredits spent: ${calls} of ${budget} (~$${(calls * USD_PER_CREDIT).toFixed(2)})`,
  );
}

/** Print the distribution of every trajectory signal against its live threshold. */
function line(name: string, vals: number[], dp = 2): void {
  const s = vals.slice().sort((a, b) => a - b);
  if (!s.length) { console.log(`${name.padEnd(12)} (no data)`); return; }
  console.log(
    `${name.padEnd(12)}` +
      `${pct(s, 10).toFixed(dp).padStart(8)}` +
      `${pct(s, 50).toFixed(dp).padStart(8)}` +
      `${pct(s, 75).toFixed(dp).padStart(8)}` +
      `${pct(s, 90).toFixed(dp).padStart(8)}` +
      `${s[s.length - 1]!.toFixed(dp).padStart(8)}`,
  );
}

/**
 * Reads only from the local cache — costs nothing and can be re-run freely as
 * thresholds change. This is why the raw payloads are stored.
 */
function report(platform: string, since?: string): void {
  // Default to the newest cached window. Passing today's computed `since`
  // would miss everything fetched on any earlier day.
  const window = since ?? (cache
    .prepare("SELECT MAX(since) AS s FROM cm_history WHERE platform = ?")
    .get(platform) as { s: string | null } | undefined)?.s;
  if (!window) { console.log(`no cached ${platform} history — run the study first`); return; }
  const rows = cache
    .prepare("SELECT cm_track_id, payload FROM cm_history WHERE platform = ? AND since = ?")
    .all(platform, window) as unknown as { cm_track_id: number; payload: string }[];

  const doublings: number[] = [], sustain: number[] = [], burst: number[] = [], peak: number[] = [];
  const tally = new Map<string, number>();
  for (const row of rows) {
    const pts = realPoints(JSON.parse(row.payload));
    if (pts.length < 2) continue;
    const s = trajectorySignals(pts[0]!.plays, pts[0]!.capturedAt, pts[pts.length - 1]!.capturedAt, pts);
    doublings.push(s.doublings); sustain.push(s.sustain);
    burst.push(s.burstShare); peak.push(s.peak);
    // The badge the REAL classifier would award, so measured rarity is
    // an award rate rather than a threshold-crossing proxy.
    const c = classifyByAffinity(s);
    const k = badgeName(c.primary, c.secondary).label;
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }

  console.log(`\n${"=".repeat(64)}\nMEASURED TRAJECTORY SIGNALS — ${platform}, ${doublings.length} tracks\n${"=".repeat(64)}`);
  console.log(`${"".padEnd(12)}${"p10".padStart(8)}${"p50".padStart(8)}${"p75".padStart(8)}${"p90".padStart(8)}${"max".padStart(8)}`);
  line("doublings", doublings);
  line("sustain", sustain);
  line("burstShare", burst);
  line("peak", peak);

  const share = (v: number[], f: (x: number) => boolean) =>
    v.length ? `${((v.filter(f).length / v.length) * 100).toFixed(0)}%` : "—";

  // Read the thresholds from the config rather than repeating them here —
  // hardcoded copies silently lie the moment a value is tuned.
  const A = AFFINITY;
  const row = (name: string, v: number, result: string) =>
    console.log(`  ${name.padEnd(18)} ${String(v).padEnd(6)} → ${result}`);
  console.log(`\nWhere the live thresholds fall:`);
  row("moonshotDoublings", A.moonshotDoublings, `${share(doublings, (d) => d >= A.moonshotDoublings)} of tracks reach it`);
  row("riserSustain", A.riserSustain, `${share(sustain, (v) => v >= A.riserSustain)} sustain at or above`);
  row("riserDoublings", A.riserDoublings, `${share(doublings, (d) => d >= A.riserDoublings)} at or above`);
  row("breakoutFloor", A.breakoutFloor, `${share(burst, (v) => v >= A.breakoutFloor)} burstShare at or above`);
  row("breakoutFull", A.breakoutFull, `${share(burst, (v) => v >= A.breakoutFull)} at or above`);
  row("flatlineDoublings", A.flatlineDoublings, `${share(doublings, (d) => d < A.flatlineDoublings)} below (reads as Flatline)`);
  const n = doublings.length;
  console.log(`
MEASURED BADGE RARITY (what BADGE_RARITY.trackShare comes from):`);
  for (const [label, count] of [...tally].sort((a, b) => b[1] - a[1])) {
    console.log(
      `  ${label.padEnd(14)} ${String(count).padStart(3)}/${n}   ` +
        `${((count / n) * 100).toFixed(1).padStart(5)}%`,
    );
  }

  console.log(
    `\nNote: burstShare and peak are time-windowed so they compare across\n` +
      `cadences. sustain counts snapshots, so a daily series and the sim's\n` +
      `6/day are not strictly equivalent — treat sustain as indicative.`,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Early-call check — can we PROVE someone was early?
//
// A first-played date on its own is just a date. The claim "you were on this
// before it blew up" needs the track's play count AT that moment, which Spotify
// has never exposed. Chartmetric does have dated stream history, and unlike the
// SoundCloud attempt the resolution here is EXACT: the export gives us Spotify
// track URIs and /track/spotify/{id}/get-ids accepts them directly, so there is
// no fuzzy name matching to produce false positives.
//
// The open question this answers is how far back the history actually reaches.
// ═══════════════════════════════════════════════════════════════════════════

interface Candidate {
  track_name: string; artist_name: string; track_uri: string;
  first_played: string; play_count: number;
}

async function earlyCall(want: number) {
  const historyDb = new DatabaseSync(
    process.env.SPOTIFY_HISTORY_DB ?? path.join(HERE, "..", "firstfan-spotify.db"),
  );
  const rows = historyDb
    .prepare(
      `SELECT track_name, artist_name, track_uri, first_played, play_count
         FROM spotify_track_history
        WHERE user_id = 1 AND play_count >= 40
        ORDER BY first_played
        LIMIT ?`,
    )
    .all(want) as unknown as Candidate[];
  historyDb.close();
  if (!rows.length) { console.log("no imported history — run npm run spotify:import first"); return; }

  const tok = await token();
  console.log(`
checking ${rows.length} early calls
${"=".repeat(74)}`);

  let resolved = 0, withHistory = 0, provable = 0;
  let earliestPointSeen: string | null = null;

  for (const row of rows) {
    if (calls >= budget - 3) { console.log("⚠ budget reached"); break; }
    const spotifyId = row.track_uri.replace("spotify:track:", "");
    const label = `${(row.track_name ?? "?").slice(0, 30).padEnd(30)} ${(row.artist_name ?? "?").slice(0, 16).padEnd(16)}`;

    const idRes = await cmGet(tok, `/track/spotify/${spotifyId}/get-ids`);
    if (!idRes.ok) { console.log(`  ✗ ${label} resolve HTTP ${idRes.status}`); continue; }
    const o = unwrap(idRes.json);
    const first = Array.isArray(o) ? o[0] : o;
    const cmId: number | undefined = first?.chartmetric_ids?.[0] ?? first?.cm_track;
    if (!cmId) { console.log(`  ✗ ${label} not in Chartmetric`); continue; }
    resolved++;

    // Ask from well before the first play, to find the true start of coverage.
    const since = row.first_played.slice(0, 10);
    const r = await cmGet(tok, `/track/${cmId}/spotify/stats/most-history?type=streams&since=${since}`);
    if (!r.ok) { console.log(`  ~ ${label} cm#${cmId} stats HTTP ${r.status}`); continue; }

    const pts = realPoints(r.json);
    if (pts.length < 2) { console.log(`  ~ ${label} cm#${cmId} no usable points`); continue; }
    withHistory++;

    const earliest = pts[0]!;
    const latest = pts[pts.length - 1]!;
    if (!earliestPointSeen || earliest.capturedAt < earliestPointSeen) earliestPointSeen = earliest.capturedAt;

    // Provable only if coverage actually starts at or before the first play.
    const covered = earliest.capturedAt.slice(0, 10) <= since;
    if (covered) provable++;
    const mult = earliest.plays! > 0 ? latest.plays! / earliest.plays! : 0;

    console.log(
      `  ${covered ? "✓" : "·"} ${label} played ${since}
` +
        `      cm#${String(cmId).padEnd(9)} data from ${earliest.capturedAt.slice(0, 10)}  ` +
        `${earliest.plays!.toLocaleString()} → ${latest.plays!.toLocaleString()} streams  ${mult.toFixed(1)}x`,
    );
  }

  console.log(`
${"=".repeat(74)}`);
  console.log(`resolved to Chartmetric : ${resolved}/${rows.length}`);
  console.log(`with usable history     : ${withHistory}`);
  console.log(`PROVABLY early (coverage reaches the first play): ${provable}`);
  console.log(`earliest data point seen anywhere: ${earliestPointSeen?.slice(0, 10) ?? "none"}`);
  console.log(`credits spent: ${calls} (~$${(calls * USD_PER_CREDIT).toFixed(2)})`);
}

const [cmd, arg, budgetArg] = process.argv.slice(2);
if (cmd === "probe") {
  budget = Math.max(2, Number(budgetArg) || DEFAULT_BUDGET);
  console.log(`budget: ${budget} credits (~$${(budget * USD_PER_CREDIT).toFixed(2)}) — hard cap\n`);
  try {
    await probe(Math.max(1, Math.min(50, Number(arg) || 4)));
  } catch (e) {
    if (e instanceof BudgetExhausted) console.log(`\n⚠ ${e.message}`);
    else throw e;
  }
} else if (cmd === "spotify" || cmd === "applemusic" || cmd === "soundcloud") {
  budget = Math.max(2, Number(budgetArg) || DEFAULT_BUDGET);
  console.log(`budget: ${budget} credits (~$${(budget * USD_PER_CREDIT).toFixed(2)}) — hard cap\n`);
  try {
    await platformStudy(cmd, Math.max(1, Math.min(100, Number(arg) || 40)));
  } catch (e) {
    if (e instanceof BudgetExhausted) console.log(`\n⚠ ${e.message}`);
    else throw e;
  }
} else if (cmd === "earlycall") {
  budget = Math.max(4, Number(budgetArg) || DEFAULT_BUDGET);
  console.log(`budget: ${budget} credits (~$${(budget * USD_PER_CREDIT).toFixed(2)}) — hard cap`);
  try {
    await earlyCall(Math.max(1, Math.min(40, Number(arg) || 10)));
  } catch (e) {
    if (e instanceof BudgetExhausted) console.log(`
⚠ ${e.message}`);
    else throw e;
  }
} else if (cmd === "analyze") {
  // Free: re-derives every signal from cached raw series. No network at all.
  report(arg || "spotify", budgetArg || undefined);
} else {
  console.log(
    "usage:\n" +
      "  chartmetric.ts probe      [perBucket=4] [creditBudget=60]  SoundCloud coverage\n" +
      "  chartmetric.ts spotify    [tracks=40]   [creditBudget=60]  measured signals\n" +
      "  chartmetric.ts soundcloud [tracks=40]   [creditBudget=60]  same, SoundCloud\n" +
      "  chartmetric.ts applemusic [tracks=40]   [creditBudget=60]  same, Apple Music (unsupported)\n" +
      "  chartmetric.ts analyze    [platform=spotify] [since]       re-analyze cache, FREE",
  );
  process.exit(1);
}
