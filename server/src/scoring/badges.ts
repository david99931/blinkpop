/**
 * Badge classification and per-badge scoring — PURE, like the rest of the
 * scoring layer. Given a pick and its track's snapshot history, produce the
 * badge the run earned and the score under that badge's own formula.
 *
 * Scores are comparable only WITHIN a badge. That is the whole point: a
 * Juggernaut (already-big track adding millions of plays) and a Moonshot
 * (tiny track running away) are different achievements, and forcing one
 * formula to price both fairly is what made every earlier version fight
 * itself.
 */

import {
  BADGE_ORDER,
  BADGE_RULES,
  BADGE_SCORING,
  ORDER_DECAY,
  SUPER_PICK,
  underdogTierFor,
  type Badge,
  type PickKind,
} from "@firstfan/shared";

const DAY_MS = 86_400_000;
const BURST_DAYS = 7;

export interface TrajectorySignals {
  /** plays gained since the pick's baseline */
  gained: number;
  /** doublings since baseline: log2(final / baseline) */
  doublings: number;
  /** best 7-day gain ÷ baseline — burst intensity relative to YOUR entry */
  peak: number;
  /** share of observed days still adding meaningful plays */
  sustain: number;
  /** share of the whole gain that landed in the single best 7-day window */
  burstShare: number;
  baselinePlays: number;
  finalPlays: number;
}

export interface SignalInput {
  plays: number | null;
  capturedAt: string;
}

/** Trajectory signals for a pick, from snapshots inside its live window. */
export function trajectorySignals(
  baselinePlays: number,
  pickedAt: string,
  expiresAt: string,
  history: readonly SignalInput[],
): TrajectorySignals {
  const pickedMs = Date.parse(pickedAt);
  const expiresMs = Date.parse(expiresAt);
  const snaps = history
    .filter((s) => s.plays !== null)
    .map((s) => ({ plays: s.plays!, ms: Date.parse(s.capturedAt) }))
    .filter((s) => s.ms >= pickedMs && s.ms <= expiresMs)
    .sort((a, b) => a.ms - b.ms);

  const base = Math.max(1, baselinePlays);
  if (snaps.length === 0) {
    return { gained: 0, doublings: 0, peak: 0, sustain: 0, burstShare: 0,
      baselinePlays, finalPlays: baselinePlays };
  }

  const finalPlays = snaps[snaps.length - 1]!.plays;
  const gained = Math.max(0, finalPlays - baselinePlays);

  // Per-snapshot deltas, and the best BURST_DAYS window measured in real time
  // (snapshot cadence varies between sim and live, so window by timestamp).
  let prev = baselinePlays;
  const steps = snaps.map((s) => {
    const d = Math.max(0, s.plays - prev);
    prev = s.plays;
    return { ms: s.ms, delta: d };
  });

  let peakWindow = 0;
  for (let i = 0; i < steps.length; i++) {
    const until = steps[i]!.ms + BURST_DAYS * DAY_MS;
    let sum = 0;
    for (let j = i; j < steps.length && steps[j]!.ms <= until; j++) sum += steps[j]!.delta;
    if (sum > peakWindow) peakWindow = sum;
  }

  const meaningful = gained / Math.max(1, steps.length) * 0.25;
  const active = steps.filter((s) => s.delta > Math.max(1, meaningful)).length;

  return {
    gained,
    doublings: finalPlays > base ? Math.log2(finalPlays / base) : 0,
    peak: peakWindow / base,
    sustain: steps.length ? active / steps.length : 0,
    burstShare: gained > 0 ? peakWindow / gained : 0,
    baselinePlays,
    finalPlays,
  };
}

/** Which badge this run earned. First match wins; see BADGE_RULES. */
export function classifyBadge(s: TrajectorySignals): Badge {
  const R = BADGE_RULES;
  if (
    s.burstShare >= R.breakoutBurstShare &&
    s.doublings >= R.breakoutMinDoublings &&
    s.gained >= R.breakoutMinGained
  ) {
    return "breakout";
  }
  if (s.doublings >= R.moonshotMinDoublings) return "moonshot";
  if (
    s.baselinePlays >= R.juggernautMinBaseline &&
    s.gained >= R.juggernautMinGained &&
    s.doublings < R.juggernautMaxDoublings
  ) {
    return "juggernaut";
  }
  if (s.doublings >= R.riserMinDoublings && s.gained >= R.riserMinGained) return "riser";
  return "flatline";
}

/** Badges only ever move up BADGE_ORDER — a status object is never revoked. */
export function higherBadge(a: Badge, b: Badge): Badge {
  return BADGE_ORDER.indexOf(a) >= BADGE_ORDER.indexOf(b) ? a : b;
}

export interface ScoreInput {
  artistAvgPlays: number | null;
  pickRank: number;
  kind: PickKind;
}

export function orderDecay(rank: number): number {
  return Math.max(ORDER_DECAY.floor, Math.pow(ORDER_DECAY.base, rank - 1));
}

/** Score this run under its badge's own formula. */
export function badgeScore(badge: Badge, s: TrajectorySignals, pick: ScoreInput): number {
  const w = BADGE_SCORING[badge];
  const tier = w.useArtistTier
    ? underdogTierFor(pick.artistAvgPlays ?? s.baselinePlays).multiplier
    : 1;
  const mult = tier * orderDecay(pick.pickRank) * (pick.kind === "super" ? SUPER_PICK.multiplier : 1);

  const core =
    (s.gained / 1000) * w.perGainK +
    s.doublings * w.perDoubling +
    s.doublings * s.doublings * w.doublingSq +
    Math.log2(1 + s.peak) * w.perBurst;

  return mult * core * (w.sustain ? 0.5 + s.sustain : 1);
}

export interface BadgeVerdict {
  badge: Badge;
  points: number;
  signals: TrajectorySignals;
}

/** Classify + score in one pass. Pure: same history always gives the same verdict. */
export function evaluatePick(
  baselinePlays: number | null,
  pickedAt: string,
  expiresAt: string,
  history: readonly SignalInput[],
  pick: ScoreInput,
): BadgeVerdict | null {
  if (baselinePlays === null) return null; // provider stats disabled — pending data
  const signals = trajectorySignals(baselinePlays, pickedAt, expiresAt, history);
  const badge = classifyBadge(signals);
  return { badge, points: badgeScore(badge, signals, pick), signals };
}
