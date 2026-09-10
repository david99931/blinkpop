/**
 * Where discovery starts someone.
 *
 * The band is the one number the whole discovery system turns on, and it is the
 * thing most likely to be tuned later — so the PROPERTIES are pinned here
 * rather than the exact constants. A tuning pass should be free to move the
 * numbers; it should not be free to invert the relationships.
 *
 * The regression that motivated this: a purely score-derived band put a user
 * whose likes sit at 68,049 plays onto 11,154-play tracks — six times below
 * anything they had shown an appetite for.
 */

import { describe, expect, it } from "vitest";
import { bandFor } from "../src/domain/listener-profile.ts";

const FULL_CONFIDENCE = 4.5;

describe("bandFor — anchored on what they already like", () => {
  it("starts BELOW the anchor, but within reach of it", () => {
    const { band } = bandFor(68_049, 0.61, FULL_CONFIDENCE);
    expect(band.centre).toBeLessThan(68_049);
    // The bug: 6x below. Anything past ~4x is noise rather than discovery.
    expect(band.centre).toBeGreaterThan(68_049 / 4);
  });

  it("steps a bold listener further down than a timid one", () => {
    const timid = bandFor(100_000, 0.1, FULL_CONFIDENCE).band.centre;
    const bold = bandFor(100_000, 0.9, FULL_CONFIDENCE).band.centre;
    expect(bold).toBeLessThan(timid);
  });

  it("scales with the anchor — a niche listener is never handed mainstream tracks", () => {
    const digger = bandFor(5_000, 0.6, FULL_CONFIDENCE).band.centre;
    const casual = bandFor(500_000, 0.6, FULL_CONFIDENCE).band.centre;
    expect(digger).toBeLessThan(casual);
    expect(digger).toBeLessThan(5_000);
  });

  it("always contains its own centre", () => {
    for (const a of [500, 5_000, 68_049, 1_000_000]) {
      const { band } = bandFor(a, 0.5, FULL_CONFIDENCE);
      expect(band.min).toBeLessThanOrEqual(band.centre);
      expect(band.max).toBeGreaterThanOrEqual(band.centre);
    }
  });
});

describe("bandFor — when we don't know", () => {
  it("falls back to an abstract scale with no anchor", () => {
    const { band } = bandFor(null, 0.5, 0);
    expect(band.centre).toBeGreaterThan(0);
    expect(Number.isFinite(band.centre)).toBe(true);
  });

  it("casts WIDER when confidence is low — uncertainty widens, never narrows", () => {
    const sure = bandFor(50_000, 0.5, FULL_CONFIDENCE).band;
    const unsure = bandFor(50_000, 0.5, 0).band;
    expect(unsure.max - unsure.min).toBeGreaterThan(sure.max - sure.min);
  });

  it("never suggests a floor below what a real track could have", () => {
    expect(bandFor(300, 0.95, FULL_CONFIDENCE).band.min).toBeGreaterThanOrEqual(50);
  });
});
