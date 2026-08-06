/**
 * Demo world (sim mode only): a ~94-day story staged so every screen has
 * drama — hockey-stick charts, an early-bird board with winners and
 * latecomers, a busy feed, and fresh picks inside the trending window.
 *
 * All demo accounts share the password "demo1234".
 */

import { getDb } from "../db/db.ts";
import { makePick } from "../domain/picks.ts";
import { follow } from "../domain/social.ts";
import { createUser } from "../domain/users.ts";
import { hashPassword } from "../domain/auth.ts";
import { isRealTime, simDay } from "./clock.ts";
import { warp } from "./warp.ts";

export interface SeedResult {
  created: boolean;
  users: { id: number; handle: string }[];
  picks: string[];
  endDay: number;
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
    return { created: false, users, picks: [], endDay: simDay() };
  }
  if (simDay() !== 0) {
    throw new Error("Seed the demo before warping (fresh DB expected). Delete firstfan.db to reset.");
  }

  const demoHash = hashPassword("demo1234");
  const handles = ["ava", "ben", "cleo", "dana", "eli", "faye", "gus", "hana"] as const;
  const users = handles.map((h) =>
    createUser({ handle: h, displayName: h[0]!.toUpperCase() + h.slice(1), email: `${h}@demo.local`, passwordHash: demoHash }),
  );
  const byHandle = new Map(users.map((u) => [u.handle, u]));
  const u = (h: (typeof handles)[number]) => byHandle.get(h)!;

  // Everyone follows ava (the star); the first three follow each other.
  for (const other of handles.slice(1)) follow(u(other).id, "ava");
  follow(u("ava").id, "ben");
  follow(u("ava").id, "cleo");
  follow(u("ben").id, "cleo");
  follow(u("cleo").id, "ben");

  const picks: string[] = [];
  const pick = async (handle: (typeof handles)[number], trackId: string, kind: "daily" | "super" = "daily") => {
    await makePick(u(handle).id, trackId, kind);
    picks.push(`${handle}:${trackId}${kind === "super" ? ":super" : ""}`);
  };

  // Day 0 — the founding calls: dream at 600 plays, a mega-track, a dud.
  await pick("ava", "story-dream");
  await pick("ben", "story-bigartist");
  await pick("cleo", "story-flatline");

  warp(2); // day 2 — eli burns a SUPER on the dream while it's still tiny.
  await pick("eli", "story-dream", "super");
  await pick("dana", "story-riser");

  warp(3); // day 5 — faye gambles on a catalog moonshot.
  await pick("faye", "mock-0000");

  warp(15); // day 20 — gus joins the dream mid-curve (~3k plays).
  await pick("gus", "story-dream");

  warp(54); // day 74 — hana chases the dream late (~310k plays, 0.3× tier).
  await pick("hana", "story-dream");

  warp(16); // day 90 — fresh calls inside the trending window.
  await pick("ava", "mock-0010");
  await pick("ben", "mock-0060"); // a spike-and-die archetype — variety on Trends
  await pick("dana", "mock-0001");

  warp(4); // day 94 — let the fresh picks breathe.

  return {
    created: true,
    users: users.map((x) => ({ id: x.id, handle: x.handle })),
    picks,
    endDay: simDay(),
  };
}
