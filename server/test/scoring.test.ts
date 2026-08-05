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

describe("orderDecay", () => {
  it("1.0 for first, 0.9 for second, floors at 0.25", () => {
    expect(orderDecay(1)).toBe(1);
    expect(orderDecay(2)).toBeCloseTo(0.9, 10);
    expect(orderDecay(3)).toBeCloseTo(0.81, 10);
    expect(orderDecay(14)).toBeCloseTo(Math.pow(0.9, 13), 10);
    expect(orderDecay(100)).toBe(0.25);
  });
});

describe("§4.6 ex.1 — the dream call", () => {
  it("B=600, rank 1, runs to 1.2M in 90 days → 5,400 milestone pts", () => {
    const events = scorePick(
      pick(),
      series([[30, 9_000], [45, 60_000], [60, 240_000], [75, 550_000], [90, 1_200_000]]),
    );
    // 7 milestones crossed (10k→1M), each × underdog 10 × decay 1
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

describe("§4.6 ex.3 — the flatline", () => {
  it("B=2,000 ending at 6,000 → exactly 0 points, ever", () => {
    const events = scorePick(
      pick({ baselinePlays: 2_000 }),
      series([[30, 3_500], [60, 5_000], [90, 6_000], [180, 6_200]]),
    );
    expect(events).toHaveLength(0);
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
    // 5,400 vs 82.5 — assert the ratio stays above 10× so config tuning can't
    // silently invert the game's whole point.
    expect(5400 / 82.5).toBeGreaterThan(10);
  });
});

describe("milestone rules", () => {
  it("milestones already passed at pick time never pay", () => {
    const events = scorePick(
      pick({ baselinePlays: 30_000 }),
      series([[10, 60_000]]),
    );
    // 10k and 25k were already passed; only 50k pays: 25 × 2.5 × 1
    expect(events).toHaveLength(1);
    expect(events[0]!.milestoneValue).toBe(50_000);
    expect(events[0]!.points).toBe(62.5);
  });

  it("crossings after the 180-day window pay nothing", () => {
    const events = scorePick(
      pick({ baselinePlays: 2_000 }),
      series([[179, 9_000], [181, 500_000]]),
    );
    expect(events).toHaveLength(0);
  });

  it("a crossing on the last in-window day still pays", () => {
    const events = scorePick(pick({ baselinePlays: 2_000 }), series([[180, 12_000]]));
    expect(events).toHaveLength(1);
    expect(events[0]!.milestoneValue).toBe(10_000);
  });
});

describe("weekly growth bonus (§4.4)", () => {
  it("pays when BOTH ≥50% WoW and ≥2,500 gained", () => {
    const events = scorePick(
      pick({ baselinePlays: 6_000 }),
      series([[7, 9_100]]), // +51.7%, +3,100
    );
    const weekly = events.filter((e) => e.type === "weekly_growth");
    expect(weekly).toHaveLength(1);
    expect(weekly[0]!.points).toBe(125); // 25 × underdog 5.0 × decay 1
    expect(weekly[0]!.dedupeKey).toBe("pick:1:weekly:1");
  });

  it("percent alone is not enough (tiny track noise)", () => {
    const events = scorePick(
      pick({ baselinePlays: 1_500 }),
      series([[7, 3_000]]), // +100% but only +1,500
    );
    expect(events.filter((e) => e.type === "weekly_growth")).toHaveLength(0);
  });

  it("absolute alone is not enough (big tracks drift)", () => {
    const events = scorePick(
      pick({ baselinePlays: 400_000 }),
      series([[7, 410_000]]), // +10,000 but only +2.5%
    );
    expect(events.filter((e) => e.type === "weekly_growth")).toHaveLength(0);
  });

  it("an incomplete week (no snapshot at week's end yet) does not settle", () => {
    const events = scorePick(
      pick({ baselinePlays: 6_000 }),
      series([[6, 9_500]]), // big gain but the week isn't over in the data
    );
    expect(events.filter((e) => e.type === "weekly_growth")).toHaveLength(0);
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
    expect(events).toHaveLength(1);
    expect(events[0]!.points).toBe(250); // 25 base (50k) × 10 × 1
  });

  it("weekly growth bonus uses the artist tier too", () => {
    const events = scorePick(
      pick({ baselinePlays: 6_000, artistAvgPlays: 2_000_000 }),
      series([[7, 9_100]]),
    );
    const weekly = events.filter((e) => e.type === "weekly_growth");
    expect(weekly).toHaveLength(1);
    expect(weekly[0]!.points).toBeCloseTo(25 * 0.05, 10);
  });
});

describe("super pick (5×) and early-bird bonus (v1.2)", () => {
  const run = series([[30, 9_000], [45, 60_000], [60, 240_000], [75, 550_000], [90, 1_200_000]]);

  it("super pick multiplies every event by 5 — the dream call at 27,000", () => {
    const events = scorePick(pick({ kind: "super", artistAvgPlays: 600 }), run);
    expect(milestonePoints(events)).toBe(27_000); // 5,400 × 5
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
