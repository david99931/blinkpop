import { beforeAll, describe, expect, it } from "vitest";

process.env.FIRSTFAN_DB = ":memory:";
process.env.SIM_SEED = "trending-test";

const { migrate } = await import("../src/db/migrate.ts");
const { createUser } = await import("../src/domain/users.ts");
const { makePick } = await import("../src/domain/picks.ts");
const { warp } = await import("../src/sim/warp.ts");
const { buildTrending } = await import("../src/routes/trending.ts");

beforeAll(async () => {
  migrate();
  const ava = createUser({ handle: "ava", email: "a@t.dev" });
  const ben = createUser({ handle: "ben", email: "b@t.dev" });
  const dana = createUser({ handle: "dana", email: "d@t.dev" });
  // Day 0: two old picks (outside the 7-day window after warping)
  await makePick(ava.id, "story-dream");
  await makePick(ben.id, "story-dream");
  await makePick(dana.id, "story-flatline");
  warp(9);
  // Day 9: a fresh pick — the only one inside the window at day 10
  await makePick(ava.id, "story-riser");
  warp(1); // now = day 10
});

describe("trending", () => {
  it("ranks recent pickers first, then growth", () => {
    const items = buildTrending();
    expect(items.map((i) => i.providerTrackId)).toEqual([
      "story-riser", // 1 picker inside the window beats everything
      "story-dream", // 0 recent, but explosive growth
      "story-flatline", // 0 recent, barely moves
    ]);
  });

  it("computes window delta from the snapshot series", () => {
    const dream = buildTrending().find((i) => i.providerTrackId === "story-dream")!;
    expect(dream.pickersTotal).toBe(2);
    expect(dream.pickersRecent).toBe(0);
    expect(dream.deltaPlays).toBeGreaterThan(0);
    expect(dream.deltaPct).toBeGreaterThan(0);
    expect(dream.currentPlays).toBeGreaterThan(1000);
    expect(dream.sparkline.length).toBeGreaterThan(2);
    // series is chronological
    const s = dream.sparkline;
    for (let i = 1; i < s.length; i++) expect(s[i]!.capturedAt >= s[i - 1]!.capturedAt).toBe(true);
  });

  it("only picked tracks trend", () => {
    expect(buildTrending()).toHaveLength(3);
  });
});
