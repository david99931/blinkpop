/**
 * The simulated music universe: ~500 generated tracks across growth
 * archetypes (spec §6) plus the hand-authored story tracks.
 *
 * Deterministic: getUniverse(seed) always produces the same tracks with the
 * same trajectories. Daily play increments come from a per-track RNG stream
 * that is always consumed from day 0 forward, so plays-at-day-N is stable
 * regardless of when it's asked for.
 */

import { Rng } from "./rng.ts";
import { STORY_TRACKS } from "./story-tracks.ts";

export type Archetype = "moonshot" | "riser" | "spike" | "flatliner" | "slowburn" | "story";

export interface SimStats {
  plays: number;
  likes: number;
  reposts: number;
}

export interface SimTrack {
  providerTrackId: string;
  title: string;
  artistName: string;
  archetype: Archetype;
  statsAt(day: number): SimStats;
}

export const DEFAULT_SEED = process.env.SIM_SEED ?? "firstfan-v1";

const GENERATED_COUNT = 500;
// Archetype mix per spec §6: 2% moonshot, 10% riser, 8% spike-and-die,
// 10% slow-burn, rest (~70%) flatliners.
const MIX: readonly { type: Archetype; count: number }[] = [
  { type: "moonshot", count: 10 },
  { type: "riser", count: 50 },
  { type: "spike", count: 40 },
  { type: "slowburn", count: 50 },
  { type: "flatliner", count: 350 },
];

const TITLE_A = [
  "Midnight", "Velvet", "Broken", "Neon", "Silver", "Hollow", "Golden", "Fading",
  "Electric", "Paper", "Wild", "Quiet", "Burning", "Frozen", "Lonely", "Static",
  "Crimson", "Pale", "Distant", "Heavy",
];
const TITLE_B = [
  "Hearts", "Signals", "Motions", "Rivers", "Echoes", "Windows", "Shadows", "Sirens",
  "Fires", "Tides", "Letters", "Ghosts", "Summers", "Wires", "Roses", "Storms",
  "Mirrors", "Diamonds", "Islands", "Voices",
];
const ARTIST_A = [
  "Luna", "Kai", "Nova", "Iris", "Theo", "Sable", "Juno", "Ezra", "Wren", "Milo",
  "Rae", "Onyx", "Cleo", "Dante", "Faye", "Rio", "Skye", "Vince", "Zara", "Nico",
];
const ARTIST_B = [
  "Waves", "Atlas", "Vega", "Monroe", "Fields", "Harbor", "Knight", "Colors",
  "Bloom", "Frost", "Reyes", "Stone", "Avenue", "Marlow", "Winters", "Cruz",
  "Hollow", "Blue", "Park", "Steel",
];

interface TrackParams {
  archetype: Archetype;
  startPlays: number;
  likeRate: number;
  repostRate: number;
  // flatliner / spike drip
  drip: number;
  // riser / slowburn
  weeklyGrowth: number;
  taperPerDay: number; // multiplicative decay of growth rate
  // spike
  spikeDay: number;
  spikeTotal: number;
  // moonshot
  moonTarget: number;
  moonMidpoint: number;
  moonSteepness: number;
  // slowburn
  dormantUntil: number;
}

class GeneratedTrack implements SimTrack {
  readonly providerTrackId: string;
  readonly title: string;
  readonly artistName: string;
  readonly archetype: Archetype;
  private readonly p: TrackParams;
  private readonly noise: Rng;
  /** cumulative plays, index = day; grown lazily but always sequentially */
  private series: number[] = [];

  constructor(seed: string, index: number, params: TrackParams, title: string, artist: string) {
    this.providerTrackId = `mock-${String(index).padStart(4, "0")}`;
    this.title = title;
    this.artistName = artist;
    this.archetype = params.archetype;
    this.p = params;
    this.noise = new Rng(`${seed}:daily:${index}`);
  }

  private incrementFor(day: number, prevPlays: number): number {
    const p = this.p;
    const n = this.noise.range(0.5, 1.5); // per-day noise, consumed exactly once per day
    switch (p.archetype) {
      case "flatliner":
        return Math.round(p.drip * n);
      case "riser": {
        const weekly = p.weeklyGrowth * Math.pow(p.taperPerDay, day);
        const daily = Math.pow(1 + weekly, 1 / 7) - 1;
        return Math.round(prevPlays * daily * n);
      }
      case "slowburn": {
        if (day < p.dormantUntil) return Math.round(p.drip * n);
        const sinceTakeoff = day - p.dormantUntil;
        const weekly = p.weeklyGrowth * Math.pow(p.taperPerDay, sinceTakeoff);
        const daily = Math.pow(1 + weekly, 1 / 7) - 1;
        return Math.round(prevPlays * daily * n);
      }
      case "spike": {
        if (day >= p.spikeDay && day < p.spikeDay + 7) {
          return Math.round((p.spikeTotal / 7) * n);
        }
        return Math.round(p.drip * n);
      }
      case "moonshot": {
        const logistic = (d: number) =>
          p.moonTarget / (1 + Math.exp(-p.moonSteepness * (d - p.moonMidpoint)));
        return Math.max(0, Math.round((logistic(day) - logistic(day - 1)) * n));
      }
      case "story":
        throw new Error("story tracks don't use GeneratedTrack");
    }
  }

  statsAt(day: number): SimStats {
    if (day < 0) day = 0;
    if (this.series.length === 0) this.series.push(this.p.startPlays);
    while (this.series.length <= day) {
      const d = this.series.length; // day being generated
      const prev = this.series[d - 1]!;
      this.series.push(prev + this.incrementFor(d, prev));
    }
    const plays = this.series[day]!;
    return {
      plays,
      likes: Math.floor(plays * this.p.likeRate),
      reposts: Math.floor(plays * this.p.repostRate),
    };
  }
}

function makeParams(r: Rng, archetype: Archetype): TrackParams {
  const p: TrackParams = {
    archetype,
    startPlays: 0,
    likeRate: r.range(0.01, 0.04),
    repostRate: r.range(0.002, 0.009),
    drip: 0,
    weeklyGrowth: 0,
    taperPerDay: 1,
    spikeDay: 0,
    spikeTotal: 0,
    moonTarget: 0,
    moonMidpoint: 0,
    moonSteepness: 0,
    dormantUntil: 0,
  };
  switch (archetype) {
    case "flatliner":
      // Mostly tiny; a slice of already-popular dead catalog so "picking a big
      // track" is testable (underdog floor tiers).
      p.startPlays = r.chance(0.12)
        ? Math.round(r.rangeLow(250_000, 6_000_000))
        : Math.round(r.rangeLow(50, 40_000));
      p.drip = r.rangeLow(0, 40);
      break;
    case "riser":
      p.startPlays = Math.round(r.rangeLow(200, 30_000));
      p.weeklyGrowth = r.range(0.2, 0.6);
      p.taperPerDay = r.range(0.985, 0.997); // growth cools over months
      break;
    case "slowburn":
      p.startPlays = Math.round(r.rangeLow(100, 8_000));
      p.drip = r.rangeLow(0, 15);
      p.dormantUntil = r.int(30, 90);
      p.weeklyGrowth = r.range(0.4, 1.0);
      p.taperPerDay = r.range(0.985, 0.996);
      break;
    case "spike":
      p.startPlays = Math.round(r.rangeLow(100, 20_000));
      p.drip = r.rangeLow(0, 25);
      p.spikeDay = r.int(5, 60);
      p.spikeTotal = Math.round(r.rangeLow(20_000, 400_000));
      break;
    case "moonshot":
      p.startPlays = Math.round(r.rangeLow(100, 3_000));
      p.moonTarget = Math.round(r.range(1_000_000, 8_000_000));
      p.moonMidpoint = r.range(40, 110);
      p.moonSteepness = r.range(0.08, 0.18);
      break;
    case "story":
      break;
  }
  return p;
}

class StorySimTrack implements SimTrack {
  readonly archetype: Archetype = "story";
  constructor(
    readonly providerTrackId: string,
    readonly title: string,
    readonly artistName: string,
    private readonly playsAt: (day: number) => number,
    private readonly likeRate: number,
    private readonly repostRate: number,
  ) {}

  statsAt(day: number): SimStats {
    const plays = this.playsAt(Math.max(0, day));
    return {
      plays,
      likes: Math.floor(plays * this.likeRate),
      reposts: Math.floor(plays * this.repostRate),
    };
  }
}

/**
 * Snapshots per simulated day. Real mode polls every 2h; the sim emits 6
 * (every 4 sim-hours) so charts have intraday texture instead of one smooth
 * point per day.
 */
export const SNAPSHOTS_PER_DAY = 6;

/**
 * Plays at intraday slot `slot` (1..slots) of `day`. A day's gain is split
 * across slots with uneven, deterministic weights — some slots crawl, some
 * surge — so the line looks like a real ticker rather than a clean ramp.
 * Monotonic by construction (weights are positive), and slot === slots
 * always equals statsAt(day) exactly, so the daily series is unchanged.
 */
export function statsAtSlot(
  track: SimTrack,
  day: number,
  slot: number,
  slots: number = SNAPSHOTS_PER_DAY,
  seed: string = DEFAULT_SEED,
): SimStats {
  if (slot >= slots || day <= 0) return track.statsAt(day);
  const prev = track.statsAt(day - 1);
  const end = track.statsAt(day);

  // Weights are drawn from a stream keyed by (track, day) so they never
  // disturb the daily increment stream.
  const r = new Rng(`${seed}:intraday:${track.providerTrackId}:${day}`);
  const weights: number[] = [];
  for (let i = 0; i < slots; i++) {
    // Wide spread + a ~20% chance of a surge slot: that contrast is what
    // makes the line change slope and the volume panel spike.
    weights.push(r.range(0.08, 1) * (r.chance(0.2) ? r.range(3, 6) : 1));
  }
  const total = weights.reduce((s, w) => s + w, 0);
  let cum = 0;
  for (let i = 0; i < slot; i++) cum += weights[i]!;
  const f = cum / total;

  const lerp = (a: number, b: number) => Math.round(a + (b - a) * f);
  return {
    plays: lerp(prev.plays, end.plays),
    likes: lerp(prev.likes, end.likes),
    reposts: lerp(prev.reposts, end.reposts),
  };
}

const universeCache = new Map<string, Map<string, SimTrack>>();

export function getUniverse(seed: string = DEFAULT_SEED): Map<string, SimTrack> {
  const cached = universeCache.get(seed);
  if (cached) return cached;

  const tracks = new Map<string, SimTrack>();
  const paramRng = new Rng(`${seed}:params`);
  const nameRng = new Rng(`${seed}:names`);

  let index = 0;
  for (const { type, count } of MIX) {
    for (let i = 0; i < count && index < GENERATED_COUNT; i++, index++) {
      const title = `${nameRng.pick(TITLE_A)} ${nameRng.pick(TITLE_B)}`;
      const artist = nameRng.chance(0.3)
        ? nameRng.pick(ARTIST_A)
        : `${nameRng.pick(ARTIST_A)} ${nameRng.pick(ARTIST_B)}`;
      const t = new GeneratedTrack(seed, index, makeParams(paramRng, type), title, artist);
      tracks.set(t.providerTrackId, t);
    }
  }

  for (const s of STORY_TRACKS) {
    tracks.set(
      s.providerTrackId,
      new StorySimTrack(s.providerTrackId, s.title, s.artistName, s.playsAt, s.likeRate, s.repostRate),
    );
  }

  universeCache.set(seed, tracks);
  return tracks;
}
