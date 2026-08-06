/**
 * Intraday snapshot generation — the jaggedness that makes charts read like
 * a ticker. Must stay deterministic, monotonic, and agree with the daily
 * series at day boundaries.
 */

import { describe, expect, it } from "vitest";
import { getUniverse, SNAPSHOTS_PER_DAY, statsAtSlot } from "../src/sim/catalog.ts";

const u = getUniverse("intraday-test");
const track = u.get("story-dream")!;

describe("statsAtSlot", () => {
  it("the last slot of a day equals that day's canonical value", () => {
    for (const day of [1, 7, 30, 90]) {
      expect(statsAtSlot(track, day, SNAPSHOTS_PER_DAY).plays).toBe(track.statsAt(day).plays);
    }
  });

  it("is monotonic within a day and across the boundary", () => {
    let prev = track.statsAt(29).plays;
    for (const day of [30, 31]) {
      for (let slot = 1; slot <= SNAPSHOTS_PER_DAY; slot++) {
        const p = statsAtSlot(track, day, slot).plays;
        expect(p).toBeGreaterThanOrEqual(prev);
        prev = p;
      }
    }
  });

  it("is deterministic — same slot, same answer", () => {
    const a = statsAtSlot(track, 45, 3).plays;
    const b = statsAtSlot(track, 45, 3).plays;
    expect(a).toBe(b);
  });

  it("slopes vary between slots (this is the jank we want)", () => {
    // Gains per slot on a fast-growing day should NOT all be equal.
    const day = 80;
    const gains: number[] = [];
    let prev = track.statsAt(day - 1).plays;
    for (let slot = 1; slot <= SNAPSHOTS_PER_DAY; slot++) {
      const p = statsAtSlot(track, day, slot).plays;
      gains.push(p - prev);
      prev = p;
    }
    const min = Math.min(...gains);
    const max = Math.max(...gains);
    expect(max).toBeGreaterThan(min * 1.5); // meaningfully uneven
    expect(gains.reduce((s, g) => s + g, 0)).toBe(
      track.statsAt(day).plays - track.statsAt(day - 1).plays,
    );
  });

  it("day 0 has no intraday history to interpolate", () => {
    expect(statsAtSlot(track, 0, 1).plays).toBe(track.statsAt(0).plays);
  });
});
