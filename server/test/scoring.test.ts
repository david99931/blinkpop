/**
 * Spec §4.6 worked examples, pinned exactly. If a config change breaks one of
 * these numbers on purpose, update the fixture AND the spec together.
 */

import { describe, expect, it } from "vitest";
import { orderDecay, scorePick, type SnapshotPoint } from "../src/scoring/engine.ts";

const T0 = Date.parse("2026-08-01T12:00:00.000Z");
const DAY = 86_400_000;
const iso = (day: number) => new Date(T0 + day * DAY).toISOString();

/** Snapshot series from (day, plays) pairs. */
const series = (points: [number, number][]): SnapshotPoint[] =>
  points.map(([d, plays]) => ({ plays, capturedAt: iso(d) }));

// artistAvgPlays: null exercises the track-baseline fallback, which is what
// the §4.6 examples describe (each story artist has exactly one track, so
// artist average ≈ track baseline at pick time).
const pick = (over: Partial<Parameters<typeof scorePick>[0]> = {}) => ({
  pickId: 1,
  baselinePlays: 600,
  artistAvgPlays: null,
  pickRank: 1,
  kind: "daily" as const,
  pickedAt: iso(0),
  expiresAt: iso(180),
  ...over,
});

const milestonePoints = (events: ReturnType<typeof scorePick>) =>
  events.filter((e) => e.type === "milestone").reduce((s, e) => s + e.points, 0);
const growthPoints = (events: ReturnType<typeof scorePick>) =>
  events.filter((e) => e.type === "growth").reduce((s, e) => s + e.points, 0);
const totalPoints = (events: ReturnType<typeof scorePick>) =>
  events.reduce((s, e) => s + e.points, 0);

describe("orderDecay", () => {
  it("1.0 for first, 0.9 for second, floors at 0.25", () => {
    expect(orderDecay(1)).toBe(1);
    expect(orderDecay(2)).toBeCloseTo(0.9, 10);
    expect(orderDecay(3)).toBeCloseTo(0.81, 10);
    expect(orderDecay(14)).toBeCloseTo(Math.pow(0.9, 13), 10);
    expect(orderDecay(100)).toBe(0.25);
  });
});

describe("§4.6 ex.1 — the dream call (v2)", () => {
  it("B=600, rank 1, runs to 1.2M: ~12k growth pts + 5,400 milestone bonus", () => {
    const events = scorePick(
      pick(),
      series([[30, 9_000], [45, 60_000], [60, 240_000], [75, 550_000], [90, 1_200_000]]),
    );
    // Growth (primary): (1,200,000 − 600) / 1000 × underdog 10 × decay 1
    expect(growthPoints(events)).toBeCloseTo(11_994, 10);
    // Milestone bonuses: 7 crossed (10k→1M), each × 10 × 1
    expect(events.filter((e) => e.type === "milestone")).toHaveLength(7);
    expect(milestonePoints(events)).toBe(5400);
  });
});

describe("§4.6 ex.2 — late to the party", () => {
  it("B=300k, 14th picker → (125+250) × 0.3 × 0.9^13 ≈ 29 pts", () => {
    const events = scorePick(
      pick({ baselinePlays: 300_000, pickRank: 14 }),
      series([[10, 520_000], [20, 1_100_000]]),
    );
    const expected = (125 + 250) * 0.3 * Math.pow(0.9, 13);
    expect(milestonePoints(events)).toBeCloseTo(expected, 10);
    expect(Math.round(milestonePoints(events))).toBe(29);
  });
});

describe("§4.6 ex.3 — the flatline (v2)", () => {
  it("B=2,000 ending at 6,200 → a 21-pt drip, no milestones, no bonuses", () => {
    const events = scorePick(
      pick({ baselinePlays: 2_000 }),
      series([[30, 3_500], [60, 5_000], [90, 6_000], [180, 6_200]]),
    );
    expect(events.filter((e) => e.type === "milestone")).toHaveLength(0);
    expect(events.filter((e) => e.type === "early_bird")).toHaveLength(0);
    // 4,200 gained × 5× tier / 1000 = 21 — noise next to a real call's ~17k.
    expect(growthPoints(events)).toBeCloseTo(21, 10);
  });
});

describe("§4.6 ex.4 — big-artist pick", () => {
  it("B=4M crossing 5M and 10M → (650+1000) × 0.05 = 82.5 pts", () => {
    const events = scorePick(
      pick({ baselinePlays: 4_000_000 }),
      series([[13, 5_040_000], [75, 10_000_000]]),
    );
    expect(milestonePoints(events)).toBeCloseTo(82.5, 10);
  });
});

describe("core balance invariant", () => {
  it("one true early call beats a mega-hit run by a wide margin", () => {
    // Computed through the live engine so config tuning can't silently
    // invert the game's whole point. v2: ~17.6k vs ~382.5 (≈46×).
    const dream = totalPoints(
      scorePick(
        pick({ artistAvgPlays: 600 }),
        series([[30, 9_000], [45, 60_000], [60, 240_000], [75, 550_000], [90, 1_200_000]]),
      ),
    );
    const megaHit = totalPoints(
      scorePick(
        pick({ baselinePlays: 4_000_000, artistAvgPlays: 4_000_000 }),
        series([[13, 5_040_000], [75, 10_000_000]]),
      ),
    );
    expect(dream / megaHit).toBeGreaterThan(10);
  });
});

describe("milestone rules", () => {
  it("milestones already passed at pick time never pay", () => {
    const events = scorePick(
      pick({ baselinePlays: 30_000 }),
      series([[10, 60_000]]),
    );
    // 10k and 25k were already passed; only 50k pays: 25 × 2.5 × 1
    const milestones = events.filter((e) => e.type === "milestone");
    expect(milestones).toHaveLength(1);
    expect(milestones[0]!.milestoneValue).toBe(50_000);
    expect(milestones[0]!.points).toBe(62.5);
  });

  it("anything after the 180-day window pays nothing", () => {
    const events = scorePick(
      pick({ baselinePlays: 2_000 }),
      series([[179, 9_000], [181, 500_000]]),
    );
    // day 181 is out of window: no milestone from the 500k jump, and growth
    // only counts the in-window snapshot (9,000 − 2,000 = 7,000 → 35 pts).
    expect(events.filter((e) => e.type === "milestone")).toHaveLength(0);
    expect(growthPoints(events)).toBeCloseTo(35, 10);
  });

  it("a crossing on the last in-window day still pays", () => {
    const events = scorePick(pick({ baselinePlays: 2_000 }), series([[180, 12_000]]));
    const milestones = events.filter((e) => e.type === "milestone");
    expect(milestones).toHaveLength(1);
    expect(milestones[0]!.milestoneValue).toBe(10_000);
  });
});

describe("continuous growth accrual (§4.3 v2)", () => {
  it("pays proportionally: 1 pt per 1,000 plays gained × multipliers", () => {
    const events = scorePick(
      pick({ baselinePlays: 6_000 }), // 5× tier via baseline fallback
      series([[7, 9_100]]),
    );
    const growth = events.filter((e) => e.type === "growth");
    expect(growth).toHaveLength(1);
    expect(growth[0]!.points).toBeCloseTo(3_100 * 0.005, 10); // 15.5
    expect(growth[0]!.dedupeKey).toBe(`pick:1:growth:${iso(7)}`);
  });

  it("banks tiny gains until they're worth a whole point (no dust events)", () => {
    const events = scorePick(
      pick(), // B=600, 10× tier → 0.01 pt per play
      series([[1, 620], [2, 680], [3, 750]]),
    );
    const growth = events.filter((e) => e.type === "growth");
    // 0.2 then 0.8 banked, third snapshot releases the lot: 150 × 0.01 = 1.5
    expect(growth).toHaveLength(1);
    expect(growth[0]!.occurredAt).toBe(iso(3));
    expect(growth[0]!.points).toBeCloseTo(1.5, 10);
  });

  it("total telescopes to (final − baseline) regardless of snapshot cadence", () => {
    const sparse = scorePick(pick(), series([[90, 500_600]]));
    const dense = scorePick(
      pick(),
      series(Array.from({ length: 90 }, (_, i) => [i + 1, 600 + ((i + 1) * 500_000) / 90] as [number, number])),
    );
    expect(growthPoints(sparse)).toBeCloseTo(5_000, 5);
    expect(growthPoints(dense)).toBeCloseTo(5_000, 5);
  });

  it("growth accrual uses the artist tier", () => {
    const events = scorePick(
      pick({ baselinePlays: 6_000, artistAvgPlays: 2_000_000 }), // 0.05×
      series([[7, 106_000]]),
    );
    expect(growthPoints(events)).toBeCloseTo(100_000 * 0.05 * 0.001, 10); // 5
  });
});

describe("artist-based tiers (equal value per artist)", () => {
  const run = series([[30, 9_000], [45, 60_000], [60, 240_000], [75, 550_000], [90, 1_200_000]]);

  it("kills the big-artist-new-single exploit: 600-play track by a 4M-avg artist pays the floor", () => {
    const events = scorePick(pick({ artistAvgPlays: 4_000_000 }), run);
    // Same trajectory as the dream call, but the artist is huge:
    // 540 base × 0.05 instead of × 10.
    expect(milestonePoints(events)).toBe(27);
  });

  it("the same trajectory from a truly unknown artist keeps the full 10×", () => {
    const events = scorePick(pick({ artistAvgPlays: 600 }), run);
    expect(milestonePoints(events)).toBe(5400);
  });

  it("artist average outranks track baseline when both are present", () => {
    // Track already at 30k plays (would be 2.5× on its own numbers) but the
    // artist averages under 1k → the artist tier (10×) is what counts.
    const events = scorePick(
      pick({ baselinePlays: 30_000, artistAvgPlays: 800 }),
      series([[10, 60_000]]),
    );
    const milestones = events.filter((e) => e.type === "milestone");
    expect(milestones).toHaveLength(1);
    expect(milestones[0]!.points).toBe(250); // 25 base (50k) × 10 × 1
  });

});

describe("super pick (5×) and early-bird bonus (v1.2)", () => {
  const run = series([[30, 9_000], [45, 60_000], [60, 240_000], [75, 550_000], [90, 1_200_000]]);

  it("super pick multiplies every event by 5 — milestones, growth, early bird", () => {
    const events = scorePick(pick({ kind: "super", artistAvgPlays: 600 }), run);
    expect(milestonePoints(events)).toBe(27_000); // 5,400 × 5
    expect(growthPoints(events)).toBeCloseTo(59_970, 8); // 11,994 × 5
    const early = events.find((e) => e.type === "early_bird")!;
    expect(early.points).toBe(20 * 10 * 5); // early bird rides the 5× too
  });

  it("early bird (first 1k) pays once, when the first milestone lands", () => {
    const events = scorePick(pick({ artistAvgPlays: 600 }), run);
    const early = events.filter((e) => e.type === "early_bird");
    expect(early).toHaveLength(1);
    expect(early[0]!.points).toBe(200); // 20 × underdog 10 × decay 1
    expect(early[0]!.occurredAt).toBe(iso(45)); // the 10k crossing
    expect(early[0]!.dedupeKey).toBe("pick:1:early_bird");
  });

  it("being in the first 100 plays pays the bigger bonus", () => {
    const events = scorePick(pick({ baselinePlays: 50, artistAvgPlays: 50 }), run);
    expect(events.find((e) => e.type === "early_bird")!.points).toBe(500); // 50 × 10
  });

  it("no milestone → no early-bird payout (shotgunning tiny tracks earns nothing)", () => {
    const events = scorePick(
      pick({ baselinePlays: 50, artistAvgPlays: 50 }),
      series([[30, 5_000]]),
    );
    expect(events.filter((e) => e.type === "early_bird")).toHaveLength(0);
  });

  it("picked at 1,000+ plays → not early, no bonus", () => {
    const events = scorePick(
      pick({ baselinePlays: 2_000, artistAvgPlays: 2_000 }),
      series([[30, 12_000]]),
    );
    expect(events.filter((e) => e.type === "early_bird")).toHaveLength(0);
    expect(events.filter((e) => e.type === "milestone")).toHaveLength(1);
  });
});

describe("engine purity", () => {
  it("same inputs → identical events (order and dedupe keys stable)", () => {
    const input = series([[30, 9_000], [60, 240_000], [90, 1_200_000]]);
    const a = scorePick(pick(), input);
    const b = scorePick(pick(), [...input].reverse()); // order must not matter
    expect(a).toEqual(b);
  });

  it("null baseline (stats-disabled track) produces no events", () => {
    expect(scorePick(pick({ baselinePlays: null }), series([[30, 1_000_000]]))).toHaveLength(0);
  });
});
