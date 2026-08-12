/**
 * Scoring numbers — spec §4, v1 values. Expect tuning once real growth data
 * exists, which is why everything lives here and nothing is hardcoded in the
 * scoring engine.
 */

export interface UnderdogTier {
  /** ARTIST average plays must be strictly below this to land in the tier. */
  maxPlaysExclusive: number;
  multiplier: number;
  /** Short label for UI badges, e.g. "artist <1k — 10× tier". */
  label: string;
}

/**
 * The underdog multiplier is keyed to the ARTIST's popularity (average plays
 * across their tracks, measured at pick time), not the track's own plays.
 * Rationale: every artist gets equal expected value — a brand-new single from
 * a mega-artist starts at 0 plays but is no discovery at all, and must not
 * land in the 10× tier. Ordered smallest tier first; first match wins.
 */
export const UNDERDOG_TIERS: readonly UnderdogTier[] = [
  { maxPlaysExclusive: 1_000, multiplier: 10.0, label: "artist <1k" },
  { maxPlaysExclusive: 10_000, multiplier: 5.0, label: "artist <10k" },
  { maxPlaysExclusive: 50_000, multiplier: 2.5, label: "artist <50k" },
  { maxPlaysExclusive: 250_000, multiplier: 1.0, label: "artist <250k" },
  { maxPlaysExclusive: 1_000_000, multiplier: 0.3, label: "artist <1M" },
];

/** Artist average at or above the last tier boundary. */
export const UNDERDOG_FLOOR = { multiplier: 0.05, label: "artist 1M+" } as const;

/**
 * ── Badges (v4) ─────────────────────────────────────────────────────────
 *
 * A pick is classified by the SHAPE of its track's run, then scored by that
 * badge's own formula. Scores are comparable only WITHIN a badge — a
 * Juggernaut never has to out-score a Moonshot, which is what let the two
 * live under one roof at last.
 *
 * Ordered weakest → strongest; a badge may only ever move up this list.
 */
export const BADGE_ORDER = ["flatline", "riser", "breakout", "juggernaut", "moonshot"] as const;

export const BADGE_META: Record<
  (typeof BADGE_ORDER)[number],
  { label: string; blurb: string; icon: string }
> = {
  flatline: { label: "Flatline", icon: "▁", blurb: "Went nowhere. Where every pick starts." },
  riser: { label: "Riser", icon: "📈", blurb: "Steady, sustained climb." },
  breakout: { label: "Breakout", icon: "⚡", blurb: "One viral burst, then it settled." },
  juggernaut: { label: "Juggernaut", icon: "🏛", blurb: "Already big, and added a huge audience." },
  moonshot: { label: "Moonshot", icon: "🚀", blurb: "Ran away from where you found it." },
};

/**
 * Classification thresholds, checked in this order — first match wins.
 * Tuned against the simulator's own archetypes (see the cross-tab in
 * `server/test/badges.test.ts`): recovers 10/10 moonshots, 37/40 spikes,
 * 49/50 risers and 310/350 flatliners.
 */
export const BADGE_RULES = {
  /** A single 7-day window carried this share of the whole gain. */
  breakoutBurstShare: 0.5,
  breakoutMinDoublings: 2,
  breakoutMinGained: 5_000,
  moonshotMinDoublings: 8,
  /** Juggernaut is about ABSOLUTE reach from an already-large base. */
  juggernautMinBaseline: 250_000,
  juggernautMinGained: 250_000,
  juggernautMaxDoublings: 3,
  riserMinDoublings: 1,
  riserMinGained: 2_000,
} as const;

/**
 * Per-badge scoring weights over the shared trajectory signals:
 *   G = plays gained since baseline   D = doublings since baseline
 *   P = best 7-day gain ÷ baseline    S = share of window still growing
 *
 * `useArtistTier: false` on Juggernaut is deliberate — every holder is a
 * big-artist picker by construction, so the tier stops discriminating and
 * only shrinks that one leaderboard. Order decay and super still apply.
 */
export const BADGE_SCORING = {
  flatline: { perGainK: 0.1, perDoubling: 0, doublingSq: 0, perBurst: 0, sustain: false, useArtistTier: true },
  riser: { perGainK: 20, perDoubling: 200, doublingSq: 0, perBurst: 0, sustain: true, useArtistTier: true },
  breakout: { perGainK: 3, perDoubling: 0, doublingSq: 0, perBurst: 800, sustain: false, useArtistTier: true },
  juggernaut: { perGainK: 4, perDoubling: 200, doublingSq: 0, perBurst: 0, sustain: false, useArtistTier: false },
  moonshot: { perGainK: 1, perDoubling: 0, doublingSq: 120, perBurst: 0, sustain: false, useArtistTier: true },
} as const;

/**
 * ── Affinity classification (v5) ────────────────────────────────────────
 *
 * The v4 classifier was first-match-wins, which is a cliff: a run that
 * cleared the Juggernaut test was never measured against Moonshot at all.
 * Instead, score a run against EVERY archetype (0–1), then look at how
 * decisively the top one wins:
 *
 *   purity = topAffinity / secondAffinity
 *   purity >= PURITY_THRESHOLD  →  a pure badge (rare, the prestige object)
 *   otherwise                   →  a named hybrid of the top two
 *
 * Rarity then emerges from the data instead of being legislated: on 504
 * simulated tracks a pure Moonshot is ~0.4% at a 2× bar, while most strong
 * runs land as hybrids.
 */
export const AFFINITY = {
  /**
   * Doublings that count as a full-strength Moonshot signal.
   *
   * KEEP AT 8 — this survived a real measurement, having nearly been lowered
   * on a bad one.
   *
   * The earlier warning here said 8 was "unreachable on real data", based on
   * 502 live SoundCloud tracks whose lifetime average rate PROJECTED a maximum
   * of 2.78 doublings/180d. That method was the flaw: extrapolating a lifetime
   * average smooths away the burst it is trying to detect, so it cannot
   * produce a large number no matter how explosive the track.
   *
   * Measured properly on 40 Chartmetric tracks with real dated Spotify points
   * (2026-08-11, `npm run cm:spotify`): p50 0.43, p90 7.20, p99 10.09, max
   * 10.09 — 3 of 40 reached 8 or more. Tracks DO double eight times in 180
   * days; they just have to be new releases breaking out, e.g. 57,616 →
   * 62,625,148 streams.
   *
   * The distribution is bimodal, which is the more useful finding: established
   * catalogue sits near 0.1 doublings while breaking releases sit at 3–10,
   * with almost nothing between. Flatline and Moonshot are genuinely separate
   * populations rather than two cuts on one continuum — the archetype model is
   * measuring something real.
   *
   * Still open: this is Spotify, sampled from the top of the catalogue. What
   * it does NOT establish is how often a *picked SoundCloud track* gets there,
   * which only the corpus can answer.
   */
  moonshotDoublings: 8,
  /**
   * Juggernaut is log-scaled between these anchors, taken from 950 live
   * SoundCloud tracks (2026-08-10). The v4 flat floor of 250k/250k matched
   * 33.7% of real tracks — far too common for a badge.
   *   plays  p50 476k · p75 1.75M · p90 4.9M
   *   gain   p50 162k · p75 431k  · p90 1.07M
   */
  juggernautBaselineFloor: 100_000,
  juggernautBaselineFull: 5_000_000,
  juggernautGainFloor: 50_000,
  juggernautGainFull: 2_000_000,
  /** Burst share below this reads as ordinary growth, not a breakout. */
  breakoutFloor: 0.2,
  breakoutFull: 0.7,
  breakoutDoublings: 2,
  riserSustain: 0.6,
  riserDoublings: 3,
  /**
   * Riser and Juggernaut FADE OUT as a run gets extreme, so the archetypes
   * are mutually exclusive rather than nested. Without this every moonshot
   * also scores as a perfect riser and nothing is ever pure.
   */
  riserFadeFrom: 4,
  riserZeroAt: 10,
  juggernautFadeFrom: 2,
  juggernautZeroAt: 6,
  /** Doublings at which the Flatline signal has fully decayed. */
  flatlineDoublings: 1.5,
  /** Top affinity must clear this or the run is simply a Flatline. */
  minTopAffinity: 0.25,
  /** How decisively the leader must win to earn a pure badge. */
  purityThreshold: 2.0,
} as const;

/** Named hybrids — the collectible surface. Keys are the sorted pair. */
export const HYBRID_NAMES: Record<string, { label: string; blurb: string; icon: string }> = {
  "moonshot|riser": { label: "Ascendant", icon: "🌗", blurb: "Went very far, and never stopped climbing." },
  "breakout|moonshot": { label: "Supernova", icon: "💥", blurb: "One explosive week that never came back down." },
  "juggernaut|moonshot": { label: "Titan", icon: "🗿", blurb: "Already huge — and still ran away from you." },
  "juggernaut|riser": { label: "Steamroller", icon: "🛞", blurb: "Enormous, and compounding anyway." },
  "breakout|juggernaut": { label: "Aftershock", icon: "🌋", blurb: "A big track jolted back to life." },
  "breakout|riser": { label: "Second Wind", icon: "🍃", blurb: "Spiked, then kept on going." },
  "flatline|riser": { label: "Ember", icon: "🕯", blurb: "Barely moving — but not dead." },
  "breakout|flatline": { label: "One Hit", icon: "🎯", blurb: "A single flare, then silence." },
  "flatline|juggernaut": { label: "Monolith", icon: "🧱", blurb: "Vast, and utterly still." },
  "flatline|moonshot": { label: "Bolt", icon: "🌩", blurb: "Nothing, nothing, nothing — then everything." },
};

/**
 * Entry multiple (v3) — how much of the run you actually called.
 *
 * Every score event is scaled by how many times the track has DOUBLED since
 * your baseline, at the moment the event is earned:
 *
 *     factor = log2(playsNow / baseline) / neutralDoublings
 *
 * This replaced the per-tier "ideal growth rate" bar, which turned out to be
 * measuring track AGE rather than performance: a track's growth as a
 * percentage of its own plays is ≈ 1/age, so real (old) tracks could never
 * clear any fixed percentage bar while brand-new ones cleared it trivially.
 * Live SoundCloud sampling put real tracks at ~0.1%/day against bars we had
 * set at 0.3–4%/day. See `server/scripts/calibrate-ideal.mjs`.
 *
 * Doublings are age-independent and measure the thing the game is actually
 * about: how far a track ran AFTER you called it. A dead track produces no
 * doublings, so it earns nothing — which is the job the bar was there to do.
 *
 * The factor is computed from plays at the time of each event, never from the
 * track's final state, so score events stay append-only and settlement stays
 * idempotent (see `dedupe_key`).
 */
export const ENTRY_MULTIPLE = {
  /** Doublings that equal a 1.0× factor. 1 = "your multiplier is how many times it doubled". */
  neutralDoublings: 1,
  /** Below this many doublings an event isn't worth emitting. */
  minFactor: 0.02,
} as const;

/** Scale factor for an event earned when the track sits at `playsNow`. */
export function entryMultipleFactor(basePlays: number, playsNow: number): number {
  const base = Math.max(1, basePlays);
  if (playsNow <= base) return 0;
  return Math.log2(playsNow / base) / ENTRY_MULTIPLE.neutralDoublings;
}

export interface Milestone {
  plays: number;
  basePoints: number;
}

/** Absolute play milestones; already-passed-at-pick-time milestones never pay. */
export const MILESTONES: readonly Milestone[] = [
  { plays: 10_000, basePoints: 10 },
  { plays: 25_000, basePoints: 15 },
  { plays: 50_000, basePoints: 25 },
  { plays: 100_000, basePoints: 40 },
  { plays: 250_000, basePoints: 75 },
  { plays: 500_000, basePoints: 125 },
  { plays: 1_000_000, basePoints: 250 },
  { plays: 2_500_000, basePoints: 400 },
  { plays: 5_000_000, basePoints: 650 },
  { plays: 10_000_000, basePoints: 1000 },
];

/** orderDecay(rank) = max(floor, base^(rank-1)); rank 1 = first picker. */
export const ORDER_DECAY = { base: 0.9, floor: 0.25 } as const;

/**
 * Continuous growth accrual (§4.3) — the PRIMARY point source.
 * points = plays gained × (pointsPer1k / 1000) × underdog(A) × decay × super,
 * emitted per snapshot as the track grows (every couple of hours in live
 * mode). Gains bank up until they're worth ≥ minEventPoints, so tiny tracks
 * don't spray dust events.
 *
 * v2.2: growth only accrues while the track is AT OR ABOVE its tier's ideal
 * curve. Falling behind the benchmark costs you the earnings you'd have made
 * — it never takes back points already banked.
 */
export const GROWTH = {
  pointsPer1k: 1,
  minEventPoints: 1,
} as const;

/** Picks accrue points for this long, then expire (portfolio keeps them forever). */
export const PICK_WINDOW_DAYS = 180;

/**
 * Early-bird bonus: reward for being among the track's first listeners
 * (track plays at pick time below the boundary). Deliberately NOT paid at
 * pick time — it lands as a separate score event when the track crosses its
 * FIRST milestone, so shotgunning tiny tracks earns nothing.
 * Ordered smallest first; first match wins; null above the last boundary.
 */
export const EARLY_BIRD_TIERS = [
  { maxPlaysExclusive: 100, basePoints: 50, label: "first 100" },
  { maxPlaysExclusive: 1_000, basePoints: 20, label: "first 1k" },
] as const;

export function earlyBirdTierFor(
  baselinePlays: number,
): { basePoints: number; label: string } | null {
  for (const t of EARLY_BIRD_TIERS) {
    if (baselinePlays < t.maxPlaysExclusive) return t;
  }
  return null;
}

/**
 * Weekly super pick: an EXTRA pick (doesn't consume the daily slot), limited
 * to one per user-local ISO week. Every point the pick earns — milestones,
 * weekly growth, early bird — is multiplied.
 */
export const SUPER_PICK = { multiplier: 5, perWeek: 1 } as const;


/**
 * Tier lookup used by both the scoring engine and UI badges.
 * Input: the artist's average plays at pick time. Callers without artist
 * stats (legacy picks, providers with stats disabled) fall back to the
 * track's baseline plays — the pre-artist-tier behavior.
 */
export function underdogTierFor(
  artistAvgPlays: number,
): { multiplier: number; label: string } {
  for (const t of UNDERDOG_TIERS) {
    if (artistAvgPlays < t.maxPlaysExclusive) return t;
  }
  return UNDERDOG_FLOOR;
}
