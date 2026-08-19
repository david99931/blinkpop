/**
 * The §4.6 balance invariant, re-pinned against the LIVE scoring path.
 *
 * It used to be tested against `scoring/engine.ts`, which settlement stopped
 * calling when badges landed — so the spec's headline guarantee was being
 * checked on code that never ran. These assertions go through `badges.ts`
 * instead, which is what settlement actually uses.
 *
 * The invariant also had to be restated. Under v3 one number ranked every pick,
 * so "an early call beats a mega-hit run" was a global comparison. Badges
 * deliberately dissolved that: scores are comparable only WITHIN a badge, and a
 * Juggernaut never has to out-score a Moonshot. What survives — and what §4.6
 * was really protecting — is that on the SAME track, calling it early must
 * dominate calling it late.
 */

import { describe, expect, it } from "vitest";
import { blendedScore, classifyByAffinity, orderDecay, trajectorySignals, type SignalInput } from "../src/scoring/badges.ts";
import { ORDER_DECAY } from "@firstfan/shared";

const DAY = 86_400_000;
const START = Date.parse("2026-01-01T00:00:00.000Z");

/** A track that runs from `from` to `to` over 180 days, compounding smoothly. */
function run(from: number, to: number): SignalInput[] {
  const pts: SignalInput[] = [];
  for (let t = 0; t <= 180; t++) {
    const x = t / 180;
    const plays = Math.round(from * Math.pow(to / from, x));
    pts.push({ plays, capturedAt: new Date(START + t * DAY).toISOString() });
  }
  return pts;
}

function score(history: SignalInput[], baseline: number, rank: number): number {
  const from = history[0]!.capturedAt;
  const to = history[history.length - 1]!.capturedAt;
  const s = trajectorySignals(baseline, from, to, history);
  const c = classifyByAffinity(s);
  return blendedScore(c, s, { artistAvgPlays: baseline, pickRank: rank, kind: "daily" });
}

describe("orderDecay", () => {
  it("is 1.0 for the first picker and decays per place", () => {
    expect(orderDecay(1)).toBeCloseTo(1, 6);
    expect(orderDecay(2)).toBeCloseTo(ORDER_DECAY.base, 6);
    expect(orderDecay(3)).toBeCloseTo(ORDER_DECAY.base ** 2, 6);
  });

  it("never falls below the floor, however late you were", () => {
    expect(orderDecay(500)).toBe(ORDER_DECAY.floor);
    expect(orderDecay(10_000)).toBe(ORDER_DECAY.floor);
  });
});

describe("§4.6 — calling it early dominates calling it late", () => {
  // The same track, ending at the same place. Only the entry price differs.
  const full = run(600, 1_200_000);
  const late = full.slice(120); // joined once it was already ~310k

  // Measured ratios at the current weights, kept a little below the real
  // values so ordinary tuning doesn't trip them but a reversal would:
  //   early rank 1  156,292        late rank 4  23,869  (6.6x)
  //                                late rank 1  32,742  (4.8x)
  //                                flat rank 1   3,067  (51x)
  it("the early caller out-scores the late one on the same run", () => {
    const early = score(full, 600, 1);
    const latecomer = score(late, late[0]!.plays!, 4);

    expect(early).toBeGreaterThan(latecomer * 5);
  });

  it("holds even when the latecomer is given first-picker rank", () => {
    // Rank decay is not what carries this — the entry price is. The latecomer
    // captured 92% of the absolute gain and still scores about a fifth as
    // much, purely for having joined at 95k instead of 600.
    const early = score(full, 600, 1);
    const latecomer = score(late, late[0]!.plays!, 1);

    expect(early).toBeGreaterThan(latecomer * 3.5);
  });

  it("a track that never moves scores far below one that ran", () => {
    const flat = run(2_000, 6_200);
    expect(score(full, 600, 1)).toBeGreaterThan(score(flat, 2_000, 1) * 30);
  });
});
