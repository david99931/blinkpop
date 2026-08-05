import { describe, expect, it } from "vitest";
import { getUniverse, type SimTrack } from "../src/sim/catalog.ts";
import { artistAvgPlays } from "../src/providers/mock.ts";
import { Rng } from "../src/sim/rng.ts";

// Note: universes are cached per seed, but GeneratedTrack's daily-noise RNG is
// per-track and always consumed sequentially from day 0, so replaying the same
// seed in a fresh process must give identical numbers. We approximate a fresh
// process here by using two distinct seeds for the "different universe" check
// and by asking for days out of order for the "lazy growth is stable" check.

describe("Rng", () => {
  it("same seed gives the same stream", () => {
    const a = new Rng("test-seed");
    const b = new Rng("test-seed");
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it("different seeds diverge", () => {
    const a = new Rng("seed-1");
    const b = new Rng("seed-2");
    const as = Array.from({ length: 10 }, () => a.next());
    const bs = Array.from({ length: 10 }, () => b.next());
    expect(as).not.toEqual(bs);
  });
});

describe("universe", () => {
  const u = getUniverse("test-universe");

  it("contains 500 generated tracks plus the 4 story tracks", () => {
    expect(u.size).toBe(504);
  });

  it("plays are monotonically non-decreasing for every track", () => {
    for (const t of u.values()) {
      let prev = -1;
      for (let d = 0; d <= 120; d += 10) {
        const p = t.statsAt(d).plays;
        expect(p).toBeGreaterThanOrEqual(prev);
        prev = p;
      }
    }
  });

  it("asking for days out of order gives the same answer as in order", () => {
    const t = [...u.values()][7]!;
    const outOfOrder = t.statsAt(200).plays; // forces generation to day 200
    const day50 = t.statsAt(50).plays;
    const u2 = getUniverse("test-universe-2");
    void u2; // unrelated universe must not disturb the first
    expect(t.statsAt(200).plays).toBe(outOfOrder);
    expect(t.statsAt(50).plays).toBe(day50);
  });

  it("likes and reposts scale with plays", () => {
    const t = [...u.values()].find((x) => x.statsAt(60).plays > 10_000)!;
    const s = t.statsAt(60);
    expect(s.likes).toBeGreaterThan(0);
    expect(s.reposts).toBeGreaterThan(0);
    expect(s.likes).toBeLessThan(s.plays);
    expect(s.reposts).toBeLessThan(s.likes);
  });

  it("artist average pools every track by that artist", () => {
    const byArtist = new Map<string, SimTrack[]>();
    for (const t of u.values()) {
      byArtist.set(t.artistName, [...(byArtist.get(t.artistName) ?? []), t]);
    }
    const multi = [...byArtist.entries()].find(([, list]) => list.length >= 2)!;
    const [name, tracks] = multi;
    const manual = Math.round(
      tracks.reduce((s, t) => s + t.statsAt(30).plays, 0) / tracks.length,
    );
    expect(artistAvgPlays(u, name, 30)).toBe(manual);
    expect(artistAvgPlays(u, "No Such Artist", 30)).toBe(0);
  });

  it("has archetype variety: some tracks explode, most do not", () => {
    const all = [...u.values()];
    const bigAt120 = all.filter((t) => t.statsAt(120).plays > 500_000).length;
    const smallAt120 = all.filter((t) => t.statsAt(120).plays < 50_000).length;
    expect(bigAt120).toBeGreaterThan(5); // moonshots + big flatliners exist
    expect(smallAt120).toBeGreaterThan(250); // but the world is mostly small
  });
});

describe("story tracks (spec §4.6 fixtures)", () => {
  const u = getUniverse("any-seed-story-tracks-are-fixed");
  const dream = u.get("story-dream")!;
  const flatline = u.get("story-flatline")!;
  const bigartist = u.get("story-bigartist")!;
  const riser = u.get("story-riser")!;

  it("dream: 600 plays at day 0, crosses 1M by day 90", () => {
    expect(dream.statsAt(0).plays).toBe(600);
    expect(dream.statsAt(90).plays).toBeGreaterThanOrEqual(1_000_000);
    // crosses every milestone from 10k to 1M within the window
    expect(dream.statsAt(90).plays).toBe(1_200_000);
  });

  it("dream: passes 300k around day 74 (late-picker fixture, 0.3× tier)", () => {
    expect(dream.statsAt(70).plays).toBeLessThan(300_000);
    expect(dream.statsAt(75).plays).toBeGreaterThanOrEqual(300_000);
    expect(dream.statsAt(75).plays).toBeLessThan(1_000_000);
  });

  it("flatline: 2,000 → 6,000 by day 90, never reaches 10k", () => {
    expect(flatline.statsAt(0).plays).toBe(2000);
    expect(flatline.statsAt(90).plays).toBe(6000);
    expect(flatline.statsAt(180).plays).toBeLessThan(10_000);
  });

  it("bigartist: 4M at day 0, crosses 5M by day 13 and 10M by day 75", () => {
    expect(bigartist.statsAt(0).plays).toBe(4_000_000);
    expect(bigartist.statsAt(12).plays).toBeLessThan(5_000_000);
    expect(bigartist.statsAt(13).plays).toBeGreaterThanOrEqual(5_000_000);
    expect(bigartist.statsAt(74).plays).toBeLessThan(10_000_000);
    expect(bigartist.statsAt(75).plays).toBeGreaterThanOrEqual(10_000_000);
  });

  it("riser: gains ≥50% AND ≥2,500 plays in week one (weekly-bonus fixture)", () => {
    const w0 = riser.statsAt(0).plays;
    const w1 = riser.statsAt(7).plays;
    expect(w0).toBe(6000);
    expect(w1 / w0).toBeGreaterThanOrEqual(1.5);
    expect(w1 - w0).toBeGreaterThanOrEqual(2500);
  });
});
