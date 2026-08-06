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
  /**
   * The tier's IDEAL growth curve: expected daily growth as a fraction of
   * plays. This is the benchmark a pick is measured against — a track only
   * earns while it is at or above `baseline × (1 + rate)^days` (§4.3).
   *
   * Smaller artists are expected to grow faster in percentage terms, so the
   * bar is higher for them. These are v1 estimates — recalibrate from real
   * observed data with `server/scripts/calibrate-ideal.mjs` once enough
   * snapshot history exists.
   */
  idealDailyGrowth: number;
}

/**
 * The underdog multiplier is keyed to the ARTIST's popularity (average plays
 * across their tracks, measured at pick time), not the track's own plays.
 * Rationale: every artist gets equal expected value — a brand-new single from
 * a mega-artist starts at 0 plays but is no discovery at all, and must not
 * land in the 10× tier. Ordered smallest tier first; first match wins.
 */
export const UNDERDOG_TIERS: readonly UnderdogTier[] = [
  { maxPlaysExclusive: 1_000, multiplier: 10.0, label: "artist <1k", idealDailyGrowth: 0.04 },
  { maxPlaysExclusive: 10_000, multiplier: 5.0, label: "artist <10k", idealDailyGrowth: 0.025 },
  { maxPlaysExclusive: 50_000, multiplier: 2.5, label: "artist <50k", idealDailyGrowth: 0.015 },
  { maxPlaysExclusive: 250_000, multiplier: 1.0, label: "artist <250k", idealDailyGrowth: 0.01 },
  { maxPlaysExclusive: 1_000_000, multiplier: 0.3, label: "artist <1M", idealDailyGrowth: 0.006 },
];

/** Artist average at or above the last tier boundary. */
export const UNDERDOG_FLOOR = {
  multiplier: 0.05,
  label: "artist 1M+",
  idealDailyGrowth: 0.003,
} as const;

/** Plays the tier's ideal curve expects `days` after a baseline of `basePlays`. */
export function idealPlaysAt(basePlays: number, idealDailyGrowth: number, days: number): number {
  if (days <= 0) return basePlays;
  return basePlays * Math.pow(1 + idealDailyGrowth, days);
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
 * How far below its ideal curve a track has to fall before the UI calls it
 * "behind pace". Purely a display threshold — scoring gates strictly at the
 * curve (below it, growth simply stops paying).
 */
export const BEHIND_PACE_RATIO = 0.9;

/**
 * Tier lookup used by both the scoring engine and UI badges.
 * Input: the artist's average plays at pick time. Callers without artist
 * stats (legacy picks, providers with stats disabled) fall back to the
 * track's baseline plays — the pre-artist-tier behavior.
 */
export function underdogTierFor(
  artistAvgPlays: number,
): { multiplier: number; label: string; idealDailyGrowth: number } {
  for (const t of UNDERDOG_TIERS) {
    if (artistAvgPlays < t.maxPlaysExclusive) return t;
  }
  return UNDERDOG_FLOOR;
}
