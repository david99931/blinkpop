/**
 * Demo world (definition of done, spec §12): three users who follow each
 * other, day-0 picks on the story tracks plus catalog finds. After seeding,
 * warp ~90 days and watch scores, feed, and leaderboard move.
 */

import { getDb } from "../db/db.ts";
import { makePick } from "../domain/picks.ts";
import { follow } from "../domain/social.ts";
import { createUser } from "../domain/users.ts";
import { hashPassword } from "../domain/auth.ts";
import { getUniverse } from "./catalog.ts";
import { isRealTime, simDay } from "./clock.ts";

export interface SeedResult {
  created: boolean;
  users: { id: number; handle: string }[];
  picks: string[];
}

export async function seedDemo(): Promise<SeedResult> {
  if (isRealTime()) {
    throw new Error("Demo seeding is sim-only — switch FIRSTFAN_PROVIDER back to mock first");
  }
  const db = getDb();
  const existing = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  if (existing.n > 0) {
    const users = db.prepare("SELECT id, handle FROM users ORDER BY id").all() as {
      id: number;
      handle: string;
    }[];
    return { created: false, users, picks: [] };
  }
  if (simDay() !== 0) {
    throw new Error("Seed the demo before warping (fresh DB expected). Delete firstfan.db to reset.");
  }

  // Demo accounts all share the password "demo1234".
  const demoHash = hashPassword("demo1234");
  const ava = createUser({ handle: "ava", displayName: "Ava", email: "ava@demo.local", passwordHash: demoHash });
  const ben = createUser({ handle: "ben", displayName: "Ben", email: "ben@demo.local", passwordHash: demoHash });
  const cleo = createUser({ handle: "cleo", displayName: "Cleo", email: "cleo@demo.local", passwordHash: demoHash });
  for (const [a, b] of [
    [ava, ben], [ava, cleo], [ben, ava], [ben, cleo], [cleo, ava], [cleo, ben],
  ] as const) {
    follow(a.id, b.handle);
  }

  // Day-0 picks: ava calls the moonshot early, ben pays for picking a giant,
  // cleo's goes nowhere. A couple of small catalog tracks round out the demo.
  const universe = getUniverse();
  const smallCatalogIds = [...universe.values()]
    .filter((t) => t.archetype !== "story" && t.statsAt(0).plays < 1000)
    .slice(0, 2)
    .map((t) => t.providerTrackId);

  const picks: string[] = [];
  const plan: [number, string][] = [
    [ava.id, "story-dream"],
    [ben.id, "story-bigartist"],
    [cleo.id, "story-flatline"],
  ];
  for (const [userId, trackId] of plan) {
    await makePick(userId, trackId);
    picks.push(trackId);
  }
  void smallCatalogIds; // additional picks require warping a day per pick (one pick/day!)

  return {
    created: true,
    users: [ava, ben, cleo].map((u) => ({ id: u.id, handle: u.handle })),
    picks,
  };
}
