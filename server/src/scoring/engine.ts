/**
 * The scoring engine — spec §4. PURE and deterministic: score events are a
 * function of (pick, snapshot history) and the config in @firstfan/shared.
 * No clock reads, no DB, no side effects. Settlement feeds it data and
 * persists the results; recomputing from scratch always gives the same
 * events with the same dedupe keys (idempotent settlement).
 */

import {
  ENTRY_MULTIPLE,
  GROWTH,
  MILESTONES,
  ORDER_DECAY,
  SUPER_PICK,
  earlyBirdTierFor,
  entryMultipleFactor,
  underdogTierFor,
  type PickKind,
  type ScoreEventType,
} from "@firstfan/shared";

const DAY_MS = 86_400_000;

export interface ScoringPickInput {
  pickId: number;
  /** Plays at pick time (baseline snapshot). null = provider stats disabled → no scoring. */
  baselinePlays: number | null;
  /**
   * Artist average plays at pick time — drives the underdog tier so every
   * artist carries equal value. null (legacy pick / no artist stats) falls
   * back to baselinePlays.
   */
  artistAvgPlays: number | null;
  pickRank: number;
  /** "super" multiplies every event this pick earns by SUPER_PICK.multiplier. */
  kind: PickKind;
  pickedAt: string; // ISO
  expiresAt: string; // ISO — end of the 180-day live window
}

export interface SnapshotPoint {
  plays: number | null;
  capturedAt: string; // ISO
}

export interface ScoreEventDraft {
  pickId: number;
  type: ScoreEventType;
  milestoneValue: number | null;
  points: number;
  dedupeKey: string;
  /** When the event became true (crossing snapshot / end of qualifying week). */
  occurredAt: string;
}

/** rank 1 → 1.0, rank 2 → 0.9, … floored at 0.25 (spec §4.3). */
export function orderDecay(rank: number): number {
  return Math.max(ORDER_DECAY.floor, Math.pow(ORDER_DECAY.base, rank - 1));
}

/**
 * Compute every score event this pick has earned so far, given the track's
 * snapshot history. Callers may pass history in any order and including
 * null-stat rows; anything outside the pick's live window is ignored.
 */
export function scorePick(
  pick: ScoringPickInput,
  history: readonly SnapshotPoint[],
): ScoreEventDraft[] {
  const B = pick.baselinePlays;
  if (B === null) return []; // pending data (spec §5)

  const pickedMs = Date.parse(pick.pickedAt);
  const expiresMs = Date.parse(pick.expiresAt);

  const snaps = history
    .filter((s) => s.plays !== null)
    .map((s) => ({ plays: s.plays!, ms: Date.parse(s.capturedAt), iso: s.capturedAt }))
    .filter((s) => s.ms >= pickedMs && s.ms <= expiresMs)
    .sort((a, b) => a.ms - b.ms);

  const superMult = pick.kind === "super" ? SUPER_PICK.multiplier : 1;
  const tier = underdogTierFor(pick.artistAvgPlays ?? B);
  const multiplier = tier.multiplier * orderDecay(pick.pickRank) * superMult;
  /**
   * Entry multiple at the moment an event is earned — how far the track has
   * run since YOUR baseline, in doublings. Always computed from plays at that
   * snapshot (never the track's final state) so events never need restating.
   */
  const factorAt = (playsNow: number) => entryMultipleFactor(B, playsNow);
  const events: ScoreEventDraft[] = [];

  // ── Milestones (§4.3): first in-window snapshot at/above each milestone
  // the track had NOT yet passed at pick time.
  for (const m of MILESTONES) {
    if (B >= m.plays) continue; // already passed at pick time — never pays
    const crossing = snaps.find((s) => s.plays >= m.plays);
    if (!crossing) continue;
    events.push({
      pickId: pick.pickId,
      type: "milestone",
      milestoneValue: m.plays,
      points: m.basePoints * multiplier * factorAt(crossing.plays),
      dedupeKey: `pick:${pick.pickId}:milestone:${m.plays}`,
      occurredAt: crossing.iso,
    });
  }

  // ── Early-bird bonus: picked inside the track's first 100/1k plays AND the
  // call proved out (track crossed its first milestone while live). Pays once.
  const earlyTier = earlyBirdTierFor(B);
  const firstCrossing = snaps.find((s) => events.length > 0 && s.iso === events[0]!.occurredAt);
  if (earlyTier && firstCrossing) {
    events.push({
      pickId: pick.pickId,
      type: "early_bird",
      milestoneValue: null,
      points: earlyTier.basePoints * multiplier * factorAt(firstCrossing.plays),
      dedupeKey: `pick:${pick.pickId}:early_bird`,
      occurredAt: firstCrossing.iso,
    });
  }

  // ── Continuous growth accrual (§4.3, PRIMARY source): points proportional
  // to plays gained, scaled by the entry multiple at the moment they're
  // earned. There is no pace "bar": a track that stops growing produces no
  // gains, so it stops earning on its own, and one that never doubles carries
  // a factor near zero. Nothing already banked is ever taken back.
  const pointRate = GROWTH.pointsPer1k / 1000;
  let anchorPlays = B;
  for (const s of snaps) {
    const gained = s.plays - anchorPlays;
    if (gained <= 0) continue;
    const factor = factorAt(s.plays);
    if (factor < ENTRY_MULTIPLE.minFactor) continue; // barely off the baseline yet
    const points = gained * pointRate * multiplier * factor;
    if (points < GROWTH.minEventPoints) continue; // bank until it's worth an event
    events.push({
      pickId: pick.pickId,
      type: "growth",
      milestoneValue: null,
      points,
      dedupeKey: `pick:${pick.pickId}:growth:${s.iso}`,
      occurredAt: s.iso,
    });
    anchorPlays = s.plays;
  }

  return events;
}
