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

/** v4: the score lives on the pick, under the badge it earned. */
const totalPoints = (userId: number): number =>
  (
    getDb()
      .prepare("SELECT COALESCE(SUM(badge_points), 0) AS pts FROM picks WHERE user_id = ?")
      .get(userId) as { pts: number }
  ).pts;

const badgeOf = (userId: number): string =>
  (getDb().prepare("SELECT badge FROM picks WHERE user_id = ?").get(userId) as { badge: string })
    .badge;

const milestoneMoments = (userId: number): number =>
  (
    getDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM score_events e JOIN picks p ON p.id = e.pick_id
          WHERE p.user_id = ? AND e.type = 'milestone'`,
      )
      .get(userId) as { n: number }
  ).n;

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
  it("alice's dream call earns the Moonshot badge and the top score", () => {
    expect(badgeOf(alice.id)).toBe("moonshot");
    expect(totalPoints(alice.id)).toBeGreaterThan(totalPoints(bob.id));
    expect(totalPoints(alice.id)).toBeGreaterThan(totalPoints(carol.id));
    expect(milestoneMoments(alice.id)).toBe(7); // 10k → 1M, logged for the feed
  });

  it("bob's big-artist track is a Juggernaut, not a Moonshot", () => {
    // 4M → 11.2M: huge absolute reach, barely over one doubling.
    expect(badgeOf(bob.id)).toBe("juggernaut");
    expect(totalPoints(bob.id)).toBeGreaterThan(0);
  });

  it("carol's flatline stays a Riser at best and scores next to nothing", () => {
    expect(["flatline", "riser"]).toContain(badgeOf(carol.id));
    expect(milestoneMoments(carol.id)).toBe(0);
    // she ranks at the bottom of her own badge; cross-badge totals are not
    // meant to be compared, so this only checks the order of magnitude.
    expect(totalPoints(carol.id)).toBeLessThan(totalPoints(alice.id) / 20);
  });

  it("the badge is judged from YOUR entry, so a late picker gets a different one", () => {
    // Same track. alice caught it at 600 and rode ~11 doublings → Moonshot.
    // dana joined at ~310k, so the run SHE called was "already-big track adds
    // a lot of reach" → Juggernaut. Two honest badges for two real calls,
    // and they never compete on one leaderboard.
    // Which badge dana lands on is calibration-dependent (she caught the
    // final steep ramp, so it reads burst-shaped); the invariant is that a
    // late entry describes a DIFFERENT run from the one alice called.
    expect(badgeOf(alice.id)).toBe("moonshot");
    expect(badgeOf(dana.id)).not.toBe("moonshot");
  });

  it("badges separate the achievements instead of ranking them against each other", () => {
    // The point of v4: alice and bob hold DIFFERENT badges, so their scores
    // are never in competition. Both are real calls.
    expect(badgeOf(alice.id)).not.toBe(badgeOf(bob.id));
    expect(totalPoints(alice.id)).toBeGreaterThan(0);
    expect(totalPoints(bob.id)).toBeGreaterThan(0);
  });

  it("re-running settlement changes nothing (idempotent)", () => {
    const snap = () =>
      getDb()
        .prepare("SELECT id, badge, ROUND(badge_points, 6) AS pts FROM picks ORDER BY id")
        .all();
    const moments = () =>
      (getDb().prepare("SELECT COUNT(*) AS n FROM score_events").get() as { n: number }).n;
    const before = snap(), beforeMoments = moments();
    const result = settleDay(100);
    expect(result.badgesUpgraded).toBe(0);
    expect(result.momentsLogged).toBe(0);
    expect(snap()).toEqual(before);
    expect(moments()).toBe(beforeMoments);
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
    // and everyone whose badge moved got told about it
    const upgrades = getDb()
      .prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'badge_upgraded'")
      .get() as { n: number };
    expect(upgrades.n).toBeGreaterThan(0);
  });
});
