/**
 * Ideal-pace gating (§4.3 v2.2): a pick earns growth points only over
 * stretches where its track is growing at least as fast as its tier expects.
 * Going cold costs the earnings you would have made — never points already
 * banked. There are no negative events anywhere in the engine.
 */

import { describe, expect, it } from "vitest";
import { UNDERDOG_TIERS, idealPlaysAt } from "@firstfan/shared";
import { scorePick, type SnapshotPoint } from "../src/scoring/engine.ts";

const T0 = Date.parse("2026-08-01T12:00:00.000Z");
const DAY = 86_400_000;
const iso = (day: number) => new Date(T0 + day * DAY).toISOString();
const series = (points: [number, number][]): SnapshotPoint[] =>
  points.map(([d, plays]) => ({ plays, capturedAt: iso(d) }));

const pick = (over: Partial<Parameters<typeof scorePick>[0]> = {}) => ({
  pickId: 1,
  baselinePlays: 5_000,
  artistAvgPlays: 5_000, // "artist <10k" tier → ideal 2.5%/day
  pickRank: 1,
  kind: "daily" as const,
  pickedAt: iso(0),
  expiresAt: iso(180),
  ...over,
});

const RATE = UNDERDOG_TIERS.find((t) => t.label === "artist <10k")!.idealDailyGrowth;

const sum = (events: ReturnType<typeof scorePick>, type: string) =>
  events.filter((e) => e.type === type).reduce((s, e) => s + e.points, 0);

/** Daily series compounding at `rate` from `base`, scaled by `factor`. */
const compounding = (base: number, rate: number, days: number): SnapshotPoint[] =>
  series(Array.from({ length: days }, (_, i) => [i + 1, Math.round(idealPlaysAt(base, rate, i + 1))]));

describe("ideal growth curve config", () => {
  it("smaller-artist tiers are held to a higher bar", () => {
    const rates = UNDERDOG_TIERS.map((t) => t.idealDailyGrowth);
    for (let i = 1; i < rates.length; i++) expect(rates[i]!).toBeLessThan(rates[i - 1]!);
  });

  it("compounds from the baseline", () => {
    expect(idealPlaysAt(1_000, 0.04, 0)).toBe(1_000);
    expect(idealPlaysAt(1_000, 0.04, 10)).toBeCloseTo(1_000 * 1.04 ** 10, 6);
  });
});

describe("growth gating on local pace", () => {
  it("a track growing faster than its tier expects earns", () => {
    const events = scorePick(pick(), compounding(5_000, RATE * 2, 60));
    expect(sum(events, "growth")).toBeGreaterThan(0);
  });

  it("a track growing slower than its tier expects earns nothing", () => {
    const events = scorePick(pick(), compounding(5_000, RATE / 3, 60));
    expect(sum(events, "growth")).toBe(0);
  });

  it("no event in the engine is ever negative", () => {
    const events = scorePick(pick(), compounding(5_000, RATE * 3, 90));
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.points > 0)).toBe(true);
  });

  it("a spike then a long stale stretch: the stale part earns nothing", () => {
    // one explosive week, then dead flat for two months
    const spike: [number, number][] = [[1, 20_000], [2, 60_000], [3, 120_000]];
    const flat: [number, number][] = Array.from({ length: 60 }, (_, i) => [4 + i, 120_000]);
    const spikeOnly = scorePick(pick(), series(spike));
    const withFlat = scorePick(pick(), series([...spike, ...flat]));
    // the flat months add nothing at all — and take nothing away
    expect(sum(withFlat, "growth")).toBe(sum(spikeOnly, "growth"));
    expect(sum(withFlat, "growth")).toBeGreaterThan(0);
  });

  it("points banked while hot survive the track going cold", () => {
    const hot = compounding(5_000, RATE * 4, 20);
    const peak = hot[hot.length - 1]!.plays!;
    const cold = series(Array.from({ length: 90 }, (_, i) => [21 + i, peak + i])); // ~0 growth
    const events = scorePick(pick(), [...hot, ...cold]);
    expect(sum(events, "growth")).toBeGreaterThan(0);
    expect(events.every((e) => e.points > 0)).toBe(true);
  });

  it("plays gained while behind pace are forfeited, not banked for later", () => {
    // crawls for 40 days (behind pace), then explodes
    const crawl: [number, number][] = Array.from({ length: 40 }, (_, i) => [i + 1, 5_000 + (i + 1) * 10]);
    const boom: [number, number][] = [[41, 400_000]];
    const growth = sum(scorePick(pick(), series([...crawl, ...boom])), "growth");
    // credited from the last observed plays (~5,400), not the 5,000 baseline
    expect(growth).toBeCloseTo(((400_000 - 5_400) / 1000) * 5.0, 0);
  });

  it("a cold track that heats back up starts earning again", () => {
    const cold: [number, number][] = Array.from({ length: 20 }, (_, i) => [i + 1, 5_000 + i]);
    const hot: [number, number][] = Array.from({ length: 20 }, (_, i) => [
      21 + i,
      Math.round(5_020 * Math.pow(1 + RATE * 4, i + 1)),
    ]);
    const events = scorePick(pick(), series([...cold, ...hot]));
    expect(sum(events, "growth")).toBeGreaterThan(0);
  });

  it("milestones and early-bird still pay regardless of pace", () => {
    const slow = series(Array.from({ length: 120 }, (_, i) => [i + 1, 5_000 + (i + 1) * 50]));
    const events = scorePick(pick(), slow);
    expect(sum(events, "growth")).toBe(0);
    expect(sum(events, "milestone")).toBeGreaterThan(0);
  });

  it("stays deterministic — recompute yields identical events", () => {
    const history = compounding(5_000, RATE * 2, 90);
    const a = scorePick(pick(), history);
    const b = scorePick(pick(), [...history].reverse());
    expect(a).toEqual(b);
  });
});
