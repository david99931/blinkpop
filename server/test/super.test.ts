/**
 * Weekly super pick rules + early-bird, end to end. Sim epoch day 0 is
 * Saturday 2026-08-01 (ISO week 2026-W31); Monday (day 2) starts W32.
 */

import { beforeAll, describe, expect, it } from "vitest";

process.env.FIRSTFAN_DB = ":memory:";
process.env.SIM_SEED = "super-test";

const { migrate } = await import("../src/db/migrate.ts");
const { getDb } = await import("../src/db/db.ts");
const { createUser } = await import("../src/domain/users.ts");
const { makePick, isoWeekOf } = await import("../src/domain/picks.ts");
const { warp } = await import("../src/sim/warp.ts");

let alice: { id: number };
let bob: { id: number };
let alicesSuperRiser: { id: number };
let bobsDream: { id: number };

beforeAll(async () => {
  migrate();
  alice = createUser({ handle: "alice", email: "a@t.dev" });
  bob = createUser({ handle: "bob", email: "b@t.dev" });
});

describe("isoWeekOf", () => {
  it("computes ISO weeks (Monday start, Thursday decides the year)", () => {
    expect(isoWeekOf("2026-08-01")).toBe("2026-W31"); // Saturday
    expect(isoWeekOf("2026-08-02")).toBe("2026-W31"); // Sunday
    expect(isoWeekOf("2026-08-03")).toBe("2026-W32"); // Monday
    expect(isoWeekOf("2026-01-01")).toBe("2026-W01");
    expect(isoWeekOf("2027-01-01")).toBe("2026-W53"); // ISO year rollover
  });
});

describe("super pick rules", () => {
  it("a super pick works on top of the daily pick, same day", async () => {
    const daily = await makePick(alice.id, "story-dream");
    alicesSuperRiser = await makePick(alice.id, "story-riser", "super");
    expect(daily.kind).toBe("daily");
    expect(alicesSuperRiser.kind).toBe("super");
    expect(alicesSuperRiser.pickWeek).toBe("2026-W31");
    // Two picks today still count once for the streak.
    const s = getDb()
      .prepare("SELECT current_streak FROM streaks WHERE user_id = ?")
      .get(alice.id) as { current_streak: number };
    expect(s.current_streak).toBe(1);
  });

  it("a second super pick the same week is rejected", async () => {
    await expect(makePick(alice.id, "story-flatline", "super")).rejects.toMatchObject({
      code: "super_pick_used",
    });
    warp(1); // Sunday — still W31
    await expect(makePick(alice.id, "story-flatline", "super")).rejects.toMatchObject({
      code: "super_pick_used",
    });
  });

  it("Monday resets the super allowance; same-track-ever still applies", async () => {
    warp(1); // Monday — W32
    await expect(makePick(alice.id, "story-riser", "super")).rejects.toMatchObject({
      code: "already_picked_track", // used it as last week's super
    });
    const superBig = await makePick(alice.id, "story-bigartist", "super");
    expect(superBig.pickWeek).toBe("2026-W32");
  });

  it("bob's ordinary daily pick is unaffected by alice's supers", async () => {
    bobsDream = await makePick(bob.id, "story-dream"); // rank 2 behind alice
    expect(bobsDream.kind).toBe("daily");
    expect(bobsDream.pickRank).toBe(2);
  });
});

describe("super + early-bird scoring end to end (90 days settled)", () => {
  beforeAll(() => {
    warp(88); // world at day 90
  });

  const eventsFor = (pickId: number) =>
    getDb()
      .prepare("SELECT type, points FROM score_events WHERE pick_id = ?")
      .all(pickId) as { type: string; points: number }[];

  it("alice's super riser pays 5× on milestones", () => {
    // story-riser: B = 6,000 (artist avg 6,000 → 5× tier), rank 1, super ×5.
    // By day 90 it's past 1M: milestones 10k→1M = 540 base × 5 × 5 = 13,500.
    const milestones = eventsFor(alicesSuperRiser.id).filter((e) => e.type === "milestone");
    expect(milestones.reduce((s, e) => s + e.points, 0)).toBe(13_500);
  });

  it("bob's dream pick collects the early-bird bonus at rank-2 decay", () => {
    // B = 600 → first-1k tier: 20 × underdog 10 × decay 0.9 = 180.
    const early = eventsFor(bobsDream.id).filter((e) => e.type === "early_bird");
    expect(early).toHaveLength(1);
    expect(early[0]!.points).toBeCloseTo(180, 10);
  });

  it("early-bird settlement produced a notification", () => {
    const n = getDb()
      .prepare(
        "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'early_bird_awarded'",
      )
      .get(bob.id) as { n: number };
    expect(n.n).toBe(1);
  });
});
