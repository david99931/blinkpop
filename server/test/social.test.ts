/**
 * Social layer: follows, feed, leaderboard, portfolio data, notifications —
 * exercised through the domain/query functions on an in-memory world.
 */

import { beforeAll, describe, expect, it } from "vitest";

process.env.FIRSTFAN_DB = ":memory:";
process.env.SIM_SEED = "social-test";

const { migrate } = await import("../src/db/migrate.ts");
const { getDb } = await import("../src/db/db.ts");
const { createUser } = await import("../src/domain/users.ts");
const { makePick } = await import("../src/domain/picks.ts");
const { follow, unfollow, followeeIds } = await import("../src/domain/social.ts");
const { buildFeed } = await import("../src/routes/social.ts");
const { leaderboard } = await import("../src/routes/leaderboard.ts");
const { warp } = await import("../src/sim/warp.ts");

let ava: { id: number };
let ben: { id: number };
let loner: { id: number };

beforeAll(async () => {
  migrate();
  ava = createUser({ handle: "ava", email: "ava@t.dev" });
  ben = createUser({ handle: "ben", email: "ben@t.dev" });
  loner = createUser({ handle: "loner", email: "loner@t.dev" });

  follow(ava.id, "ben");
  await makePick(ava.id, "story-dream");
  await makePick(ben.id, "story-riser");
  await makePick(loner.id, "story-bigartist");
  warp(30);
});

describe("follows", () => {
  it("follow → notification for the followee; duplicate follow is a no-op", () => {
    expect(follow(ben.id, "ava")).toEqual({ followed: true });
    expect(follow(ben.id, "ava")).toEqual({ followed: false });
    const n = getDb()
      .prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'new_follower'")
      .get(ava.id) as { n: number };
    expect(n.n).toBe(1);
    expect(followeeIds(ben.id)).toEqual([ava.id]);
  });

  it("self-follow is rejected", () => {
    expect(() => follow(ava.id, "ava")).toThrowError(/follow yourself/);
  });

  it("unfollow removes the edge", () => {
    expect(unfollow(ben.id, "ava")).toEqual({ unfollowed: true });
    expect(followeeIds(ben.id)).toEqual([]);
  });
});

describe("feed", () => {
  it("shows own + followed users' picks and score events, not strangers'", () => {
    const feed = buildFeed(ava.id);
    const handles = new Set(feed.map((f) => f.handle));
    expect(handles.has("ava")).toBe(true);
    expect(handles.has("ben")).toBe(true);
    expect(handles.has("loner")).toBe(false); // ava doesn't follow loner
    expect(feed.some((f) => f.kind === "pick")).toBe(true);
    expect(feed.some((f) => f.kind === "score")).toBe(true); // 30 days of story-dream growth
  });

  it("is newest-first", () => {
    const feed = buildFeed(ava.id);
    for (let i = 1; i < feed.length; i++) {
      expect(feed[i - 1]!.at >= feed[i]!.at).toBe(true);
    }
  });
});

describe("leaderboard", () => {
  it("global all-time ranks by total points and includes zero-point users", () => {
    const { rows } = leaderboard({ period: "alltime" });
    expect(rows).toHaveLength(3);
    expect(rows[0]!.rank).toBe(1);
    const byHandle = new Map(rows.map((r) => [r.handle, r]));
    // story-dream is only ~7.5k plays at day 30 (no milestone yet), but week 4
    // qualifies for the growth bonus → ava has points.
    expect(byHandle.get("ava")!.points).toBeGreaterThan(0);
    expect(rows[rows.length - 1]!.points).toBeGreaterThanOrEqual(0);
  });

  it("friends scope only contains the user and followees", () => {
    const { rows } = leaderboard({ onlyUserIds: [ava.id, ben.id], period: "alltime" });
    expect(rows.map((r) => r.handle).sort()).toEqual(["ava", "ben"]);
  });

  it("season scope filters events to the current sim month", () => {
    const all = leaderboard({ period: "alltime" });
    const season = leaderboard({ period: "season" });
    expect(season.season).toBeDefined();
    // Sim is on day 30 (Aug 31): every event so far happened in August, so
    // season totals equal all-time totals.
    const a = new Map(all.rows.map((r) => [r.handle, r.points]));
    for (const r of season.rows) expect(r.points).toBe(a.get(r.handle));
  });

  it("after warping into next month, season resets but all-time keeps", () => {
    warp(10); // into September
    const all = leaderboard({ period: "alltime" });
    const season = leaderboard({ period: "season" });
    const avaAll = all.rows.find((r) => r.handle === "ava")!.points;
    const avaSeason = season.rows.find((r) => r.handle === "ava")!.points;
    expect(avaAll).toBeGreaterThan(avaSeason);
  });
});
