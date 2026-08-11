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
  AFFINITY,
  BADGE_META,
  BADGE_ORDER,
  BADGE_RULES,
  BADGE_SCORING,
  HYBRID_NAMES,
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

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** Log-scaled 0→1 between two anchors, so magnitudes spanning decades behave. */
const logScale = (v: number, floor: number, full: number) =>
  clamp01(Math.log10(1 + Math.max(0, v) / floor) / Math.log10(1 + full / floor));

export type Affinities = Record<Badge, number>;

/**
 * How strongly this run resembles each archetype, 0–1. Unlike the v4
 * first-match rules, every archetype is scored, so a run that is partly two
 * things can be recognised as exactly that.
 */
/**
 * Ramp up to `full`, hold, then fade out by `zero`. Without the fade the
 * archetypes nest inside each other — every moonshot is also a "perfect
 * riser", every juggernaut a "perfect flatline" — and nothing is ever pure.
 * The fade is what makes them mutually exclusive.
 */
function band(v: number, full: number, fadeFrom: number, zero: number): number {
  if (v <= 0) return 0;
  const rise = clamp01(v / full);
  const fall = v <= fadeFrom ? 1 : clamp01(1 - (v - fadeFrom) / (zero - fadeFrom));
  return rise * fall;
}

export function affinities(s: TrajectorySignals): Affinities {
  const A = AFFINITY;
  return {
    moonshot: clamp01(s.doublings / A.moonshotDoublings),
    // big, added real reach — and specifically did NOT multiply much
    juggernaut:
      logScale(s.baselinePlays, A.juggernautBaselineFloor, A.juggernautBaselineFull) *
      logScale(s.gained, A.juggernautGainFloor, A.juggernautGainFull) *
      band(Math.max(s.doublings, 0.01), 0.01, A.juggernautFadeFrom, A.juggernautZeroAt),
    breakout:
      clamp01((s.burstShare - A.breakoutFloor) / (A.breakoutFull - A.breakoutFloor)) *
      clamp01(s.doublings / A.breakoutDoublings),
    // steady AND modest: a 2000× run is a moonshot, not a riser
    riser:
      clamp01(s.sustain / A.riserSustain) *
      band(s.doublings, A.riserDoublings, A.riserFadeFrom, A.riserZeroAt),
    flatline: clamp01(1 - s.doublings / A.flatlineDoublings),
  };
}

export interface Classification {
  /** Dominant archetype — what the badge is primarily called. */
  primary: Badge;
  /** Present only when the run is a hybrid; null when it is pure. */
  secondary: Badge | null;
  /** topAffinity ÷ secondAffinity. Infinity when nothing else registers. */
  purity: number;
  affinities: Affinities;
}

/** Score every archetype, then decide pure-vs-hybrid by how decisively one wins. */
export function classifyByAffinity(s: TrajectorySignals): Classification {
  const a = affinities(s);
  const ranked = (Object.entries(a) as [Badge, number][]).sort((x, y) => y[1] - x[1]);
  const [top, second] = ranked as [[Badge, number], [Badge, number]];

  if (top[1] < AFFINITY.minTopAffinity) {
    return { primary: "flatline", secondary: null, purity: Infinity, affinities: a };
  }
  const purity = second[1] > 0.02 ? top[1] / second[1] : Infinity;
  return {
    primary: top[0],
    secondary: purity >= AFFINITY.purityThreshold ? null : second[0],
    purity,
    affinities: a,
  };
}

/** Display name for a classification — a pure badge, or its named hybrid. */
export function badgeName(primary: Badge, secondary: Badge | null): {
  label: string; icon: string; blurb: string;
} {
  if (!secondary) return BADGE_META[primary];
  const key = [primary, secondary].sort().join("|");
  return (
    HYBRID_NAMES[key] ?? {
      label: `${BADGE_META[primary].label}/${BADGE_META[secondary].label}`,
      icon: BADGE_META[primary].icon,
      blurb: `Part ${BADGE_META[primary].label.toLowerCase()}, part ${BADGE_META[secondary].label.toLowerCase()}.`,
    }
  );
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

/**
 * A hybrid scores as a blend of its two formulas, weighted by how strongly the
 * run resembles each. Continuous by construction, so a run drifting between
 * archetypes doesn't jump in value at the boundary.
 */
export function blendedScore(c: Classification, s: TrajectorySignals, pick: ScoreInput): number {
  const primary = badgeScore(c.primary, s, pick);
  if (!c.secondary) return primary;
  const a1 = c.affinities[c.primary];
  const a2 = c.affinities[c.secondary];
  const total = a1 + a2 || 1;
  return (primary * a1 + badgeScore(c.secondary, s, pick) * a2) / total;
}

export interface BadgeVerdict {
  badge: Badge;
  secondary: Badge | null;
  purity: number;
  label: string;
  icon: string;
  points: number;
  signals: TrajectorySignals;
  affinities: Affinities;
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
  const c = classifyByAffinity(signals);
  const name = badgeName(c.primary, c.secondary);
  return {
    badge: c.primary,
    secondary: c.secondary,
    purity: c.purity,
    label: name.label,
    icon: name.icon,
    points: blendedScore(c, signals, pick),
    signals,
    affinities: c.affinities,
  };
}
