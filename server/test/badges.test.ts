/**
 * Badge classification and per-badge scoring (§4 v4).
 *
 * The headline test is the cross-tab against the simulator's OWN archetypes:
 * the generator labels each track moonshot/riser/spike/slowburn/flatliner, so
 * we can check the classifier recovers what the name promises rather than
 * eyeballing a distribution.
 */

import { describe, expect, it } from "vitest";
import { BADGE_ORDER, BADGE_META } from "@firstfan/shared";
import {
  classifyBadge, higherBadge, trajectorySignals, badgeScore, evaluatePick,
  affinities, classifyByAffinity, badgeName, blendedScore,
} from "../src/scoring/badges.ts";
import { getUniverse } from "../src/sim/catalog.ts";

const T0 = Date.parse("2026-08-01T00:00:00.000Z");
const DAY = 86_400_000;
const iso = (d: number) => new Date(T0 + d * DAY).toISOString();
const series = (pts: [number, number][]) => pts.map(([d, plays]) => ({ plays, capturedAt: iso(d) }));
const ramp = (b: number, e: number, days = 180) => {
  const r = Math.pow(e / b, 1 / days) - 1;
  return series(Array.from({ length: days }, (_, i) => [i + 1, Math.round(b * Math.pow(1 + r, i + 1))]));
};
const sig = (baseline: number, hist: ReturnType<typeof series>) =>
  trajectorySignals(baseline, iso(0), iso(180), hist);

describe("badge metadata", () => {
  it("is ordered weakest to strongest and fully described", () => {
    expect(BADGE_ORDER[0]).toBe("flatline");
    expect(BADGE_ORDER[BADGE_ORDER.length - 1]).toBe("moonshot");
    for (const b of BADGE_ORDER) {
      expect(BADGE_META[b].label.length).toBeGreaterThan(0);
      expect(BADGE_META[b].blurb.length).toBeGreaterThan(0);
    }
  });

  it("only ever upgrades", () => {
    expect(higherBadge("flatline", "moonshot")).toBe("moonshot");
    expect(higherBadge("moonshot", "flatline")).toBe("moonshot");
    expect(higherBadge("riser", "breakout")).toBe("breakout");
    expect(higherBadge("juggernaut", "riser")).toBe("juggernaut");
  });
});

describe("classification", () => {
  it("a track that goes nowhere stays Flatline", () => {
    expect(classifyBadge(sig(2_000, ramp(2_000, 2_100)))).toBe("flatline");
  });

  it("a steady multi-x climb is a Riser", () => {
    expect(classifyBadge(sig(5_000, ramp(5_000, 60_000)))).toBe("riser");
  });

  it("one viral week then flat is a Breakout", () => {
    const burst = series([
      ...Array.from({ length: 7 }, (_, i) => [i + 1, 1_200 + (i + 1) * 17_000] as [number, number]),
      ...Array.from({ length: 170 }, (_, i) => [8 + i, 121_000] as [number, number]),
    ]);
    expect(classifyBadge(sig(1_200, burst))).toBe("breakout");
  });

  it("a runaway from a tiny base is a Moonshot", () => {
    expect(classifyBadge(sig(600, ramp(600, 1_200_000)))).toBe("moonshot");
  });

  it("an already-big track adding huge reach is a Juggernaut", () => {
    expect(classifyBadge(sig(4_000_000, ramp(4_000_000, 10_000_000)))).toBe("juggernaut");
  });

  it("the badge is judged from YOUR entry — same track, different call", () => {
    const early = classifyBadge(sig(600, ramp(600, 1_200_000)));
    const late = classifyBadge(sig(310_000, ramp(310_000, 1_200_000)));
    expect(early).toBe("moonshot");
    expect(late).toBe("juggernaut");
  });
});

describe("per-badge scoring", () => {
  const pick = { artistAvgPlays: null, pickRank: 1, kind: "daily" as const };

  it("a super pick scores 5× the same run", () => {
    const s = sig(600, ramp(600, 1_200_000));
    const daily = badgeScore("moonshot", s, pick);
    const superb = badgeScore("moonshot", s, { ...pick, kind: "super" });
    expect(superb).toBeCloseTo(daily * 5, 6);
  });

  it("pick order still decays within a badge", () => {
    const s = sig(600, ramp(600, 1_200_000));
    const first = badgeScore("moonshot", s, pick);
    const fourteenth = badgeScore("moonshot", s, { ...pick, pickRank: 14 });
    expect(fourteenth).toBeLessThan(first);
    expect(fourteenth).toBeGreaterThan(0);
  });

  it("Juggernaut deliberately ignores the artist tier", () => {
    const s = sig(4_000_000, ramp(4_000_000, 10_000_000));
    const unknown = badgeScore("juggernaut", s, { ...pick, artistAvgPlays: 500 });
    const famous = badgeScore("juggernaut", s, { ...pick, artistAvgPlays: 8_000_000 });
    expect(unknown).toBeCloseTo(famous, 6);
  });

  it("Moonshot weights doublings superlinearly", () => {
    const small = sig(600, ramp(600, 150_000));      // ~8 doublings
    const big = sig(600, ramp(600, 1_200_000));      // ~11 doublings
    const ratio = badgeScore("moonshot", big, pick) / badgeScore("moonshot", small, pick);
    // superlinear = the score grows FASTER than the doubling count does
    expect(ratio).toBeGreaterThan(big.doublings / small.doublings);
  });

  it("is pure — same history, same verdict", () => {
    const hist = ramp(600, 1_200_000);
    const a = evaluatePick(600, iso(0), iso(180), hist, pick);
    const b = evaluatePick(600, iso(0), iso(180), [...hist].reverse(), pick);
    expect(a).toEqual(b);
  });

  it("a pick with no provider stats yields no verdict", () => {
    expect(evaluatePick(null, iso(0), iso(180), ramp(600, 100_000), pick)).toBeNull();
  });
});

describe("cross-tab against the simulator's own archetypes", () => {
  const rows = [...getUniverse("badge-crosstab").values()].map((t) => {
    const hist = series(Array.from({ length: 180 }, (_, d) => [d + 1, t.statsAt(d + 1).plays]));
    return { archetype: t.archetype, badge: classifyBadge(sig(t.statsAt(0).plays, hist)) };
  });
  const share = (arch: string, badge: string) => {
    const of = rows.filter((r) => r.archetype === arch);
    return of.filter((r) => r.badge === badge).length / Math.max(1, of.length);
  };

  it("recovers the archetype the generator intended", () => {
    expect(share("moonshot", "moonshot")).toBe(1); // every true moonshot
    expect(share("spike", "breakout")).toBeGreaterThan(0.85);
    expect(share("flatliner", "flatline")).toBeGreaterThan(0.85);
  });

  it("reads risers as growth stories — Riser or, if they run far enough, Moonshot", () => {
    // The generator's label is a growth PATTERN; the badge is an OUTCOME. A
    // riser compounding 20–60%/week for 180 days really does pass 256×, and
    // calling that a Moonshot is correct rather than a misfire.
    expect(share("riser", "riser") + share("riser", "moonshot")).toBe(1);
    expect(share("riser", "flatline")).toBe(0);
    expect(share("riser", "breakout")).toBe(0);
  });

  it("keeps the strongest badge rare", () => {
    const moon = rows.filter((r) => r.badge === "moonshot").length / rows.length;
    // The simulator deliberately over-represents growers (30% riser/spike/
    // slow-burn by design), so this bound is generous. Real catalogues are
    // overwhelmingly flat — sampled live tracks almost never 256×.
    expect(moon).toBeLessThan(0.2);
    expect(moon).toBeGreaterThan(0);
  });

  it("leaves most picks in the bottom two badges — rarity is the product", () => {
    const low = rows.filter((r) => r.badge === "flatline" || r.badge === "riser").length / rows.length;
    expect(low).toBeGreaterThan(0.7);
  });
});

describe("affinity classification (v5) — pure vs hybrid", () => {
  it("scores every archetype rather than stopping at the first match", () => {
    const a = affinities(sig(310_000, ramp(310_000, 1_200_000)));
    // the late entry on a big track registers on BOTH axes; v4 only ever saw
    // the Juggernaut rule because it matched first
    expect(a.juggernaut).toBeGreaterThan(0.2);
    expect(a.moonshot).toBeGreaterThan(0);
    expect(Object.values(a).every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it("a decisive run earns a pure badge", () => {
    const c = classifyByAffinity(sig(600, ramp(600, 1_200_000)));
    expect(c.primary).toBe("moonshot");
    expect(c.purity).toBeGreaterThanOrEqual(2);
    expect(c.secondary).toBeNull();
  });

  it("a run that is strongly two things earns a named hybrid", () => {
    // big base, big absolute gain, and enough doublings to register as a run
    const c = classifyByAffinity(sig(400_000, ramp(400_000, 12_000_000)));
    expect(c.secondary).not.toBeNull();
    const name = badgeName(c.primary, c.secondary);
    expect(name.label.length).toBeGreaterThan(0);
    expect(name.label).not.toContain("/"); // a real name, not a fallback
  });

  it("every archetype pair has a name", () => {
    for (const a of BADGE_ORDER) {
      for (const b of BADGE_ORDER) {
        if (a === b) continue;
        expect(badgeName(a, b).label).not.toContain("/");
      }
    }
  });

  it("nothing much happening is still just a Flatline", () => {
    const c = classifyByAffinity(sig(2_000, ramp(2_000, 2_050)));
    expect(c.primary).toBe("flatline");
  });

  it("a hybrid scores between its two pure formulas", () => {
    const pick = { artistAvgPlays: null, pickRank: 1, kind: "daily" as const };
    const s = sig(400_000, ramp(400_000, 12_000_000));
    const c = classifyByAffinity(s);
    if (!c.secondary) return; // only meaningful for a hybrid
    const blended = blendedScore(c, s, pick);
    const lo = Math.min(badgeScore(c.primary, s, pick), badgeScore(c.secondary, s, pick));
    const hi = Math.max(badgeScore(c.primary, s, pick), badgeScore(c.secondary, s, pick));
    expect(blended).toBeGreaterThanOrEqual(lo);
    expect(blended).toBeLessThanOrEqual(hi);
  });

  it("makes pure badges genuinely rare across the universe", () => {
    const rows = [...getUniverse("affinity-rarity").values()].map((t) => {
      const hist = series(Array.from({ length: 180 }, (_, d) => [d + 1, t.statsAt(d + 1).plays]));
      return classifyByAffinity(sig(t.statsAt(0).plays, hist));
    });
    const pureMoon = rows.filter((c) => c.primary === "moonshot" && !c.secondary).length;
    const hybrids = rows.filter((c) => c.secondary !== null).length;
    // NOTE: the simulator is far more explosive than reality. 502 sampled
    // live tracks projected ZERO instances of >=4 doublings over a 180-day
    // window (p50 0.38, p99 2.63, max 2.78), so on real data a Moonshot at
    // 8 doublings is currently unreachable. These bounds describe the sim
    // only — see the calibration note in AFFINITY.
    expect(pureMoon / rows.length).toBeLessThan(0.2);
    expect(hybrids / rows.length).toBeGreaterThan(0.15); // and mixes are common
  });
});
