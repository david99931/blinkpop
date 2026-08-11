/**
 * Entry multiple (§4.3 v3): every score event is scaled by how many times the
 * track has doubled since the pick's baseline, measured AT THE MOMENT the
 * event is earned. This replaced the per-tier growth "bar", which turned out
 * to be measuring track age rather than performance.
 */

import { describe, expect, it } from "vitest";
import { ENTRY_MULTIPLE, entryMultipleFactor } from "@firstfan/shared";
import { scorePick, type SnapshotPoint } from "../src/scoring/engine.ts";

const T0 = Date.parse("2026-08-01T12:00:00.000Z");
const DAY = 86_400_000;
const iso = (d: number) => new Date(T0 + d * DAY).toISOString();
const series = (pts: [number, number][]): SnapshotPoint[] =>
  pts.map(([d, plays]) => ({ plays, capturedAt: iso(d) }));

const pick = (over: Partial<Parameters<typeof scorePick>[0]> = {}) => ({
  pickId: 1,
  baselinePlays: 5_000,
  artistAvgPlays: 5_000,
  pickRank: 1,
  kind: "daily" as const,
  pickedAt: iso(0),
  expiresAt: iso(180),
  ...over,
});
const sum = (e: ReturnType<typeof scorePick>, t?: string) =>
  e.filter((x) => !t || x.type === t).reduce((s, x) => s + x.points, 0);

describe("entryMultipleFactor", () => {
  it("is the doubling count since baseline", () => {
    expect(entryMultipleFactor(1_000, 1_000)).toBe(0);
    expect(entryMultipleFactor(1_000, 2_000)).toBeCloseTo(1, 10);
    expect(entryMultipleFactor(1_000, 8_000)).toBeCloseTo(3, 10);
    expect(entryMultipleFactor(1_000, 1_024_000)).toBeCloseTo(10, 10);
  });

  it("never rewards a track that hasn't passed your entry", () => {
    expect(entryMultipleFactor(1_000, 900)).toBe(0);
    expect(entryMultipleFactor(1_000, 1_000)).toBe(0);
  });

  it("survives a zero baseline instead of returning Infinity", () => {
    expect(Number.isFinite(entryMultipleFactor(0, 5_000))).toBe(true);
  });
});

describe("age independence — the reason the bar was removed", () => {
  it("an old, slow track and a young, slow track score identically", () => {
    // Same trajectory, same doublings — only the calendar differs. Under the
    // old percentage bar the older track was penalised purely for its age.
    const young = scorePick(pick(), series([[5, 7_500], [10, 10_000]]));
    const old = scorePick(pick(), series([[100, 7_500], [170, 10_000]]));
    expect(sum(old, "growth")).toBeCloseTo(sum(young, "growth"), 10);
  });
});

describe("growth gating without a bar", () => {
  it("a track that never grows earns nothing", () => {
    const flat = series(Array.from({ length: 60 }, (_, i) => [i + 1, 5_000] as [number, number]));
    expect(scorePick(pick(), flat)).toHaveLength(0);
  });

  it("a track barely off its baseline earns nothing (minFactor floor)", () => {
    const creep = series([[30, Math.round(5_000 * Math.pow(2, ENTRY_MULTIPLE.minFactor / 2))]]);
    expect(sum(scorePick(pick(), creep), "growth")).toBe(0);
  });

  it("more doublings pays more, all else equal", () => {
    const x2 = sum(scorePick(pick(), series([[30, 10_000]])));
    const x4 = sum(scorePick(pick(), series([[30, 20_000]])));
    const x8 = sum(scorePick(pick(), series([[30, 40_000]])));
    expect(x4).toBeGreaterThan(x2);
    expect(x8).toBeGreaterThan(x4);
  });

  it("a spike then a long stale stretch adds nothing while stale", () => {
    const spike: [number, number][] = [[1, 20_000], [2, 60_000], [3, 120_000]];
    const flat: [number, number][] = Array.from({ length: 60 }, (_, i) => [4 + i, 120_000]);
    const spikeOnly = sum(scorePick(pick(), series(spike)));
    const withFlat = sum(scorePick(pick(), series([...spike, ...flat])));
    expect(withFlat).toBe(spikeOnly);
  });

  it("nothing already banked is ever taken back — no negative events", () => {
    const hot: [number, number][] = [[10, 50_000], [20, 200_000]];
    const cold: [number, number][] = Array.from({ length: 60 }, (_, i) => [21 + i, 200_000]);
    const events = scorePick(pick(), series([...hot, ...cold]));
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.points > 0)).toBe(true);
  });
});

describe("incremental factor keeps settlement append-only", () => {
  it("an event's points depend only on plays at that snapshot, never the final state", () => {
    const upTo60 = series([[30, 20_000], [60, 80_000]]);
    const longer = series([[30, 20_000], [60, 80_000], [90, 5_000_000]]);
    const a = scorePick(pick(), upTo60);
    const b = scorePick(pick(), longer);
    // every event the shorter history produced is reproduced byte-identically
    for (const e of a) {
      const match = b.find((x) => x.dedupeKey === e.dedupeKey);
      expect(match).toBeDefined();
      expect(match!.points).toBeCloseTo(e.points, 10);
    }
  });

  it("dedupe keys are unique and stable under recompute", () => {
    const hist = series([[30, 20_000], [60, 80_000], [90, 400_000]]);
    const a = scorePick(pick(), hist);
    const b = scorePick(pick(), [...hist].reverse());
    expect(a).toEqual(b);
    const keys = a.map((e) => e.dedupeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
