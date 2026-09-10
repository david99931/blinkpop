/**
 * What kind of listener is this, and where should discovery start them?
 *
 * Four axes, not one type. A single label collapses people who need opposite
 * treatment: "broad + mainstream" and "broad + underground" are both samplers,
 * but the first needs a gentle ramp downward while the second wants the
 * firehose immediately.
 *
 *   breadth    concentrated ↔ sampler        Spotify history      free
 *   activity   settled      ↔ exploring      Spotify history      free
 *   mainstream niche        ↔ chart-topping  Chartmetric          paid
 *   digging    safe         ↔ crate-digger   SoundCloud likes     free  ★
 *
 * `digging` is starred because it is the only axis measured by the SAME
 * activity the game asks for, on the SAME platform. Real data made this
 * unmissable: one account's Spotify listening sits at a median of 220M streams
 * while its SoundCloud likes sit at 62k plays — the same person, 3,500x apart.
 * Spotify is where people listen; SoundCloud is where they dig. Trusting the
 * Spotify number would have surfaced 500k-play tracks to someone comfortable
 * at 62k.
 *
 * Everything is expressed as a 0–1 position, never a raw count, because
 * absolute play counts are not comparable across platforms.
 *
 * THE OUTPUT THAT MATTERS is `targetBand` — the play-count range to surface.
 * It is a STARTING POINT, not a verdict. Listening history is a guess about
 * what someone will pick; their actual picks are evidence, and the game already
 * records every one. The band is meant to walk: downward while they keep
 * biting, back up if they bounce.
 */

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listeningStats } from "./listening-stats.ts";
import { buildTasteProfile } from "./taste.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_DB = process.env.CORPUS_DB ?? path.join(HERE, "..", "..", "firstfan-corpus.db");

export interface Axis {
  /** 0–1. Higher always means "further from the mainstream / more active". */
  value: number;
  /** How much to trust it: 0 when the source is missing. */
  confidence: number;
  source: string;
  note: string;
}

export interface ListenerProfile {
  breadth: Axis;
  activity: Axis;
  mainstream: Axis;
  digging: Axis;
  /** Human summary, e.g. "broad sampler, still exploring, digs moderately". */
  label: string;
  /**
   * Where to start surfacing tracks, in SoundCloud plays. A starting prior only
   * — adapt it from what they actually pick.
   */
  targetBand: { min: number; max: number; centre: number };
  /** Why this band, in one line, so the choice is auditable rather than magic. */
  reasoning: string;
  /** The mode this band was built for. */
  reach: ReachMode;
  /**
   * Every mode with its band and what it costs you — so the risk is legible
   * rather than buried. `moonshotNeeds` is the play count a pick at that centre
   * must reach to earn a Moonshot.
   */
  reachOptions: {
    mode: ReachMode; label: string; blurb: string;
    band: { min: number; max: number; centre: number };
    moonshotNeeds: number;
  }[];
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/**
 * Where a play count sits in the real SoundCloud distribution, 0–1.
 *
 * Uses the calibration corpus rather than a hardcoded scale, so "obscure" means
 * obscure relative to actual tracks rather than to a number someone guessed.
 * Falls back to a log scale between 100 and 10M when the corpus is unavailable.
 */
function playsToPercentile(plays: number): number {
  try {
    const db = new DatabaseSync(CORPUS_DB, { readOnly: true });
    try {
      const row = db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM (
                SELECT provider_track_id, MAX(captured_at) ca, plays FROM corpus_snapshots GROUP BY provider_track_id
              ) WHERE plays <= ?) AS below,
             (SELECT COUNT(DISTINCT provider_track_id) FROM corpus_snapshots) AS total`,
        )
        .get(plays) as { below: number; total: number } | undefined;
      if (row?.total) return clamp01(row.below / row.total);
    } finally {
      db.close();
    }
  } catch { /* no corpus yet — fall through */ }
  // log-scale fallback across the plausible range
  return clamp01(Math.log10(Math.max(1, plays) / 100) / Math.log10(10_000_000 / 100));
}

/** Invert a percentile into "how much they dig" — small tracks mean more digging. */
const diggingFromPercentile = (p: number): number => clamp01(1 - p);

const median = (xs: number[]): number =>
  xs.length ? xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : 0;



/**
 * How far off the beaten track to go — the user's own dial, not ours.
 *
 * Mood varies in a way no profile can capture: the same person wants safe
 * bangers on Tuesday and unheard weirdness on Saturday. An explicit choice is
 * also far cleaner signal than inferring intent from picks.
 *
 * It is a RISK dial, not just a taste one, because the band determines which
 * badges are reachable at all. Moonshot needs 8 doublings — 256x — so a pick at
 * 30,000 plays needs 7.7M to earn one, while a pick at 500 needs only 128k.
 * Playing safe caps your ceiling, and the UI should say so.
 */
export const REACH_MODES = ["comfort", "balanced", "digging", "uncharted"] as const;
export type ReachMode = (typeof REACH_MODES)[number];

export const REACH_META: Record<ReachMode, { label: string; blurb: string; factor: number }> = {
  comfort: {
    label: "Comfort",
    blurb: "Around what you already like. Safe, familiar, low ceiling.",
    factor: 1.6,
  },
  balanced: {
    label: "Balanced",
    blurb: "Just below your usual — new, but recognisably your taste.",
    factor: 1.0,
  },
  digging: {
    label: "Digging",
    blurb: "Genuinely under-played. Real room to run.",
    factor: 0.18,
  },
  uncharted: {
    label: "Uncharted",
    blurb: "Almost nobody has heard these. Most go nowhere; the ones that don't are Moonshots.",
    factor: 0.03,
  },
};

/** Doublings Moonshot demands — mirrored from AFFINITY so the copy can't drift. */
const MOONSHOT_MULTIPLE = 256;

export interface BandResult {
  band: { min: number; max: number; centre: number };
  /** Fraction of the anchor we stepped down to — surfaced for the reasoning line. */
  stepDown: number;
}

/**
 * Where to start surfacing, given what someone already likes.
 *
 * `anchor` is the median play count of their liked tracks, or null when no
 * SoundCloud account is linked. `adventure` is the confidence-weighted 0–1
 * blend of the axes. `confidenceMass` is the summed weight behind that blend —
 * low mass widens the band, because casting wide is the right response to not
 * knowing.
 *
 * Anchoring matters more than the exact constants: a purely score-derived band
 * put a 68k-plays listener onto 11k tracks, six times below anything they had
 * shown an appetite for.
 */
export function bandFor(
  anchor: number | null,
  adventure: number,
  confidenceMass: number,
  reach: ReachMode = "balanced",
): BandResult {
  // Timid profiles step to 70% of what they like; bold ones to 25%.
  const stepDown = (0.7 - 0.45 * adventure) * REACH_META[reach].factor;
  const centre = anchor
    ? Math.max(120, Math.round(anchor * stepDown))
    // No SoundCloud signal: fall back to an abstract scale spanning ~630 to 1M.
    : Math.max(120, Math.round(1_000_000 * Math.pow(10, -3.2 * adventure) * REACH_META[reach].factor));

  const spread = 1 + 2.5 * (1 - Math.min(1, confidenceMass / 4.5));
  return {
    band: {
      min: Math.max(50, Math.round(centre / (2.5 * spread))),
      max: Math.round(centre * (2.5 * spread)),
      centre,
    },
    stepDown,
  };
}

export async function listenerProfile(
  userId: number,
  reach: ReachMode = "balanced",
): Promise<ListenerProfile> {
  const stats = listeningStats(userId);
  const taste = await buildTasteProfile(userId);

  // ── breadth: how little of their listening the top 10 artists hold ──
  const top10 = stats.concentration.find((c) => c.topN === 10)?.share ?? 0;
  const breadth: Axis = stats.imported
    ? {
        // 50%+ in the top 10 is a superfan; 10% or less is a pure sampler.
        value: clamp01((50 - top10) / 40),
        confidence: 0.9,
        source: "spotify history",
        note: `top 10 artists hold ${top10}% of listening time`,
      }
    : { value: 0.5, confidence: 0, source: "none", note: "no listening history imported" };

  // ── activity: still finding new artists, or settled? ──
  const years = stats.byYear;
  const recent = years.slice(-2).reduce((s, y) => s + y.newArtists, 0) / Math.max(1, Math.min(2, years.length));
  const peak = Math.max(1, ...years.map((y) => y.newArtists));
  const activity: Axis = stats.imported
    ? {
        value: clamp01(recent / peak),
        confidence: years.length >= 3 ? 0.8 : 0.4,
        source: "spotify history",
        note: `${Math.round(recent)} new artists/year lately vs a peak of ${peak}`,
      }
    : { value: 0.5, confidence: 0, source: "none", note: "no listening history imported" };

  // ── digging: the size of what they like ON SOUNDCLOUD ──
  const scPlays = taste.tracks
    .filter((t) => t.source === "soundcloud" && t.plays !== null)
    .map((t) => t.plays!);
  const digging: Axis = scPlays.length
    ? {
        value: diggingFromPercentile(playsToPercentile(median(scPlays))),
        // The one axis measured by the same activity the game asks for.
        confidence: Math.min(0.95, 0.4 + scPlays.length / 60),
        source: "soundcloud likes",
        note: `median liked track has ${median(scPlays).toLocaleString()} plays`,
      }
    : {
        value: 0.35,
        confidence: 0,
        source: "none",
        note: "no SoundCloud account linked — the most predictive signal is missing",
      };

  // ── mainstream: filled by the Chartmetric probe when it has run ──
  const mainstream: Axis = {
    value: 0.5,
    confidence: 0,
    source: "chartmetric (not yet run)",
    note: "Spotify removed `popularity`; this axis needs a paid lookup",
  };

  // ── the band ──
  //
  // ANCHORED ON REVEALED PREFERENCE, not on an abstract score. The first cut
  // of this derived the band purely from an "adventurousness" number and put a
  // user whose likes sit at 68k plays onto 11k tracks — 6x below anything they
  // had shown an appetite for. Surfacing that on day one reads as noise, not
  // discovery, and a user who bounces teaches us nothing.
  //
  // So: start just BELOW what they already like, by a step whose size depends
  // on how adventurous they look. Broad, active, deep-digging users tolerate a
  // bigger first step; cautious ones get a smaller one. Then walk it down from
  // real picks, which is evidence rather than inference.
  const axes = [digging, breadth, activity];
  const weights = [3, 1, 0.5]; // digging dominates: same activity, same platform
  let num = 0, den = 0;
  axes.forEach((a, i) => {
    num += a.value * a.confidence * weights[i]!;
    den += a.confidence * weights[i]!;
  });
  const adventure = den > 0 ? num / den : 0.35;

  const anchor = scPlays.length ? median(scPlays) : null;
  const { band: targetBand, stepDown } = bandFor(anchor, adventure, den, reach);

  // Every mode priced up, so the UI can show what playing safe actually costs.
  const reachOptions = REACH_MODES.map((m) => {
    const b = bandFor(anchor, adventure, den, m).band;
    return {
      mode: m,
      label: REACH_META[m].label,
      blurb: REACH_META[m].blurb,
      band: b,
      moonshotNeeds: b.centre * MOONSHOT_MULTIPLE,
    };
  });

  const words = [
    breadth.value > 0.6 ? "broad sampler" : breadth.value < 0.35 ? "focused listener" : "mixed listener",
    activity.value > 0.6 ? "still exploring" : "settled",
    digging.confidence === 0
      ? "digging unknown"
      : digging.value > 0.6 ? "real crate-digger" : digging.value > 0.35 ? "digs moderately" : "sticks to the known",
  ];

  return {
    breadth, activity, mainstream, digging,
    label: words.join(", "),
    targetBand,
    reach,
    reachOptions,
    reasoning: anchor
      ? `likes sit around ${anchor.toLocaleString()} plays; adventurousness ` +
        `${adventure.toFixed(2)} → step to ${(stepDown * 100).toFixed(0)}% of that, ` +
        `so surface near ${targetBand.centre.toLocaleString()}. Walk it down as they pick.`
      : `no SoundCloud signal — falling back to an abstract scale at ` +
        `adventurousness ${adventure.toFixed(2)}, band widened to compensate. ` +
        `Learn the real band from picks.`,
  };
}
