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

describe("§4.6 ex.1 — the dream call (v3)", () => {
  it("B=600, rank 1, runs to 1.2M — ~11 doublings scale everything up", () => {
    const events = scorePick(
      pick(),
      series([[30, 9_000], [45, 60_000], [60, 240_000], [75, 550_000], [90, 1_200_000]]),
    );
    // Each event is scaled by the doublings reached when it landed, so the
    // late events (track already ~1000× up) carry most of the weight.
    expect(growthPoints(events)).toBeCloseTo(121_057.87, 1);
    expect(events.filter((e) => e.type === "milestone")).toHaveLength(7);
    expect(milestonePoints(events)).toBeCloseTo(53_874.44, 1);
    expect(totalPoints(events)).toBeCloseTo(176_261.08, 1);
  });
});

describe("§4.6 ex.2 — late to the party", () => {
  it("B=300k, 14th picker → (125+250) × 0.3 × 0.9^13 ≈ 29 pts", () => {
    const events = scorePick(
      pick({ baselinePlays: 300_000, pickRank: 14 }),
      series([[10, 520_000], [20, 1_100_000]]),
    );
    // 0.3 tier × 0.9^13 decay, now also scaled by doublings at each crossing
    expect(milestonePoints(events)).toBeCloseTo(43.3, 1);
    expect(totalPoints(events)).toBeCloseTo(139.52, 1);
  });
});

describe("§4.6 ex.3 — the flatline (v3)", () => {
  it("B=2,000 crawling to 6,200 stays noise — no milestones, no bonuses", () => {
    const events = scorePick(
      pick({ baselinePlays: 2_000 }),
      series([[30, 3_500], [60, 5_000], [90, 6_000], [180, 6_200]]),
    );
    // ~1.6 doublings, so it earns a trace — but four orders of magnitude
    // below a real call. Rarity is still the product.
    expect(events.filter((e) => e.type === "milestone")).toHaveLength(0);
    expect(events.filter((e) => e.type === "early_bird")).toHaveLength(0);
    expect(growthPoints(events)).toBeCloseTo(25.53, 1);
  });
});

describe("§4.6 ex.4 — big-artist pick", () => {
  it("B=4M crossing 5M and 10M — barely over one doubling, so it stays small", () => {
    const events = scorePick(
      pick({ baselinePlays: 4_000_000, artistAvgPlays: 4_000_000 }),
      series([[13, 5_040_000], [75, 10_000_000]]),
    );
    expect(milestonePoints(events)).toBeCloseTo(76.93, 1);
    expect(totalPoints(events)).toBeCloseTo(422.11, 1);
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
    // v3: ~418:1 — the gap widened because the dream call banked ~11
    // doublings while the mega-hit managed barely one.
    expect(dream / megaHit).toBeGreaterThan(100);
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
    expect(milestones[0]!.points).toBeCloseTo(62.5, 1); // 25 × 2.5 × 1 doubling
  });

  it("a milestone crossed further from your entry is worth more", () => {
    const near = scorePick(pick({ baselinePlays: 30_000 }), series([[10, 60_000]]));
    const far = scorePick(pick({ baselinePlays: 5_000 }), series([[10, 60_000]]));
    const at50k = (e: ReturnType<typeof scorePick>) =>
      e.find((x) => x.milestoneValue === 50_000)!.points;
    expect(at50k(far)).toBeGreaterThan(at50k(near));
  });

  it("anything after the 180-day window pays nothing", () => {
    const events = scorePick(
      pick({ baselinePlays: 2_000 }),
      series([[20, 9_000], [181, 500_000]]),
    );
    // day 181 is out of window: its 500k jump pays nothing at all.
    expect(events.filter((e) => e.type === "milestone")).toHaveLength(0);
    expect(growthPoints(events)).toBeCloseTo(75.95, 1);
  });

  it("a crossing on the last in-window day still pays", () => {
    const events = scorePick(pick({ baselinePlays: 2_000 }), series([[180, 12_000]]));
    const milestones = events.filter((e) => e.type === "milestone");
    expect(milestones).toHaveLength(1);
    expect(milestones[0]!.milestoneValue).toBe(10_000);
    expect(milestones[0]!.points).toBeCloseTo(129.25, 1);
  });
});

describe("continuous growth accrual (§4.3 v2)", () => {
  it("pays per play gained × multipliers × the entry multiple", () => {
    const events = scorePick(
      pick({ baselinePlays: 6_000 }), // 5× tier via baseline fallback
      series([[7, 9_100]]),
    );
    const growth = events.filter((e) => e.type === "growth");
    expect(growth).toHaveLength(1);
    const doublings = Math.log2(9_100 / 6_000);
    expect(growth[0]!.points).toBeCloseTo(3_100 * 0.005 * doublings, 6);
    expect(growth[0]!.dedupeKey).toBe(`pick:1:growth:${iso(7)}`);
  });

  it("banks tiny gains until they're worth a whole point (no dust events)", () => {
    // day 1 clears a doubling and pays; days 2–3 add a trickle worth well
    // under a point and bank; day 4 releases the banked gain in one event.
    const events = scorePick(pick(), series([[1, 1_200], [2, 1_210], [3, 1_220], [4, 1_400]]));
    const growth = events.filter((e) => e.type === "growth");
    expect(growth).toHaveLength(2);
    expect(growth[0]!.occurredAt).toBe(iso(1));
    expect(growth[1]!.occurredAt).toBe(iso(4));
    // the released event covers everything gained since day 1, not just day 4
    expect(growth[1]!.points).toBeCloseTo(200 * 0.01 * Math.log2(1_400 / 600), 6);
  });

  it("emits nothing at all when the gains never clear the dust threshold", () => {
    expect(scorePick(pick(), series([[1, 630], [2, 660], [3, 750]]))).toHaveLength(0);
  });

  it("a single interval pays the whole gain, scaled by its doublings", () => {
    const doublings = Math.log2(500_600 / 600);
    expect(growthPoints(scorePick(pick(), series([[90, 500_600]])))).toBeCloseTo(
      500_000 * 0.01 * doublings,
      2,
    );
  });

  it("denser sampling pays less, because early gains carry smaller multiples", () => {
    // Same destination; sampling only changes WHEN each slice is credited,
    // and early slices are worth less. Deterministic for a fixed history.
    const dense = series(
      Array.from({ length: 90 }, (_, i) => [i + 1, 600 + ((i + 1) * 500_000) / 90] as [number, number]),
    );
    const denseTotal = growthPoints(scorePick(pick(), dense));
    const sparseTotal = growthPoints(scorePick(pick(), series([[90, 500_600]])));
    expect(denseTotal).toBeGreaterThan(0);
    expect(denseTotal).toBeLessThan(sparseTotal);
    expect(growthPoints(scorePick(pick(), dense))).toBe(denseTotal);
  });

  it("growth accrual uses the artist tier", () => {
    const events = scorePick(
      pick({ baselinePlays: 6_000, artistAvgPlays: 2_000_000 }), // 0.05×
      series([[7, 106_000]]),
    );
    const doublings = Math.log2(106_000 / 6_000);
    expect(growthPoints(events)).toBeCloseTo(100_000 * 0.05 * 0.001 * doublings, 6);
  });
});

describe("artist-based tiers (equal value per artist)", () => {
  const run = series([[30, 9_000], [45, 60_000], [60, 240_000], [75, 550_000], [90, 1_200_000]]);

  it("kills the big-artist-new-single exploit: 600-play track by a 4M-avg artist pays the floor", () => {
    const events = scorePick(pick({ artistAvgPlays: 4_000_000 }), run);
    // Same trajectory as the dream call, but the artist is huge: 0.05× not 10×
    expect(totalPoints(events)).toBeCloseTo(881.31, 1);
  });

  it("the same trajectory from a truly unknown artist keeps the full 10×", () => {
    const events = scorePick(pick({ artistAvgPlays: 600 }), run);
    expect(totalPoints(events)).toBeCloseTo(176_261.08, 1);
    // exactly 200× the famous-artist version — the tier spread, intact
    const famous = totalPoints(scorePick(pick({ artistAvgPlays: 4_000_000 }), run));
    expect(totalPoints(events) / famous).toBeCloseTo(200, 6);
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
    expect(milestones[0]!.points).toBeCloseTo(250, 1); // 25 base × 10 × 1 doubling
  });

});

describe("super pick (5×) and early-bird bonus (v1.2)", () => {
  const run = series([[30, 9_000], [45, 60_000], [60, 240_000], [75, 550_000], [90, 1_200_000]]);

  it("super pick multiplies every event by 5 — milestones, growth, early bird", () => {
    const daily = scorePick(pick({ artistAvgPlays: 600 }), run);
    const superb = scorePick(pick({ kind: "super", artistAvgPlays: 600 }), run);
    expect(totalPoints(superb)).toBeCloseTo(totalPoints(daily) * 5, 6);
    expect(totalPoints(superb)).toBeCloseTo(881_305.4, 1);
  });

  it("early bird (first 1k) pays once, when the first milestone lands", () => {
    const events = scorePick(pick({ artistAvgPlays: 600 }), run);
    const early = events.filter((e) => e.type === "early_bird");
    expect(early).toHaveLength(1);
    expect(early[0]!.occurredAt).toBe(iso(45)); // the 10k crossing
    expect(early[0]!.dedupeKey).toBe("pick:1:early_bird");
    // 20 base × 10 tier × doublings at the crossing snapshot (60k, day 45)
    expect(early[0]!.points).toBeCloseTo(20 * 10 * Math.log2(60_000 / 600), 6);
  });

  it("being in the first 100 plays pays the bigger bonus", () => {
    const first100 = scorePick(pick({ baselinePlays: 50, artistAvgPlays: 50 }), run);
    const first1k = scorePick(pick({ baselinePlays: 600, artistAvgPlays: 600 }), run);
    const eb = (e: ReturnType<typeof scorePick>) => e.find((x) => x.type === "early_bird")!.points;
    expect(eb(first100)).toBeGreaterThan(eb(first1k));
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
