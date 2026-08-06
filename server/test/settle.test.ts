/**
 * End-to-end: users pick story tracks, the world warps forward, settlement
 * turns snapshots into exact point totals (definition-of-done, spec §12).
 */

import { beforeAll, describe, expect, it } from "vitest";

process.env.FIRSTFAN_DB = ":memory:";
process.env.SIM_SEED = "settle-test";

const { migrate } = await import("../src/db/migrate.ts");
const { getDb } = await import("../src/db/db.ts");
const { createUser } = await import("../src/domain/users.ts");
const { makePick } = await import("../src/domain/picks.ts");
const { warp } = await import("../src/sim/warp.ts");
const { settleDay } = await import("../src/jobs/settle.ts");

const milestoneTotal = (userId: number): number =>
  (
    getDb()
      .prepare(
        `SELECT COALESCE(SUM(e.points), 0) AS pts
           FROM score_events e JOIN picks p ON p.id = e.pick_id
          WHERE p.user_id = ? AND e.type = 'milestone'`,
      )
      .get(userId) as { pts: number }
  ).pts;

const totalPoints = (userId: number): number =>
  (
    getDb()
      .prepare(
        `SELECT COALESCE(SUM(e.points), 0) AS pts
           FROM score_events e JOIN picks p ON p.id = e.pick_id
          WHERE p.user_id = ?`,
      )
      .get(userId) as { pts: number }
  ).pts;

let alice: { id: number }; // dream call: story-dream at 600 plays, rank 1
let bob: { id: number }; //   big-artist: story-bigartist at 4M, rank 1
let carol: { id: number }; // flatline: story-flatline at 2k
let dana: { id: number }; //  late to the party: story-dream at ~310k, rank 2

beforeAll(async () => {
  migrate();
  alice = createUser({ handle: "alice", email: "a@t.dev" });
  bob = createUser({ handle: "bob", email: "b@t.dev" });
  carol = createUser({ handle: "carol", email: "c@t.dev" });
  dana = createUser({ handle: "dana", email: "d@t.dev" });

  await makePick(alice.id, "story-dream");
  await makePick(bob.id, "story-bigartist");
  await makePick(carol.id, "story-flatline");
  warp(74); // story-dream is now past 300k plays
  await makePick(dana.id, "story-dream");
  warp(26); // world is at day 100
});

describe("settlement after 100 simulated days", () => {
  it("alice (dream call) has exactly 5,400 milestone points", () => {
    expect(milestoneTotal(alice.id)).toBe(5400);
  });

  it("bob (big-artist) has exactly 82.5 milestone points", () => {
    expect(milestoneTotal(bob.id)).toBe(82.5);
  });

  it("carol (flatline) earns exactly 0 — it never beats its tier's curve", () => {
    // v2.2: growth only pays above the ideal curve, and this track is behind
    // it from the first week. Most picks scoring 0 is the intended shape.
    expect(totalPoints(carol.id)).toBe(0);
  });

  it("dana (rank 2 at ~310k baseline) got 500k+1M at 0.3 × 0.9", () => {
    expect(milestoneTotal(dana.id)).toBeCloseTo((125 + 250) * 0.3 * 0.9, 10);
  });

  it("balance invariant holds end-to-end: early call ≫ mega-hit", () => {
    expect(milestoneTotal(alice.id)).toBeGreaterThan(10 * milestoneTotal(bob.id));
  });

  it("re-running settlement changes nothing (idempotent)", () => {
    const before = getDb()
      .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(points), 0) AS pts FROM score_events")
      .get() as { n: number; pts: number };
    const result = settleDay(100);
    expect(result.eventsInserted).toBe(0);
    expect(result.pointsAwarded).toBe(0);
    const after = getDb()
      .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(points), 0) AS pts FROM score_events")
      .get() as { n: number; pts: number };
    expect(after).toEqual(before);
  });

  it("settlement produced notifications for the pick owners", () => {
    const rows = getDb()
      .prepare(
        "SELECT user_id, COUNT(*) AS n FROM notifications WHERE type = 'milestone_crossed' GROUP BY user_id",
      )
      .all() as { user_id: number; n: number }[];
    const byUser = new Map(rows.map((r) => [r.user_id, r.n]));
    expect(byUser.get(alice.id)).toBe(7); // 10k → 1M
    expect(byUser.get(bob.id)).toBe(2); // 5M (day 13) and 10M (day 75)
  });
});
