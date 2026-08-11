import type { FastifyInstance } from "fastify";
import { getDb } from "../db/db.ts";
import { BADGE_ORDER } from "@firstfan/shared";
import { listPicksForUser } from "../domain/picks.ts";
import { getUserByHandle } from "../domain/users.ts";

/** Public portfolio — the product's status artifact (spec §8.3). */
export async function portfolioRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { handle: string } }>("/api/users/:handle/portfolio", async (req, reply) => {
    const user = getUserByHandle(req.params.handle);
    if (!user) return reply.code(404).send({ error: "unknown_user" });
    const db = getDb();

    const picks = listPicksForUser(user.id);
    // Badge scores aren't comparable across badges, so the headline is the
    // badge shelf — how many of each kind you've called — not one total.
    const shelf = Object.fromEntries(
      BADGE_ORDER.map((b) => [b, picks.filter((p) => p.badge === b).length]),
    ) as Record<string, number>;
    const bestBadge = BADGE_ORDER.slice().reverse().find((b) => shelf[b]! > 0) ?? "flatline";
    const totalPoints = picks.reduce((s, p) => s + p.points, 0);

    const eventRows = db
      .prepare(
        `SELECT e.pick_id, e.type, e.milestone_value, e.points, e.computed_at
           FROM score_events e JOIN picks p ON p.id = e.pick_id
          WHERE p.user_id = ? AND e.type != 'growth' -- growth shows in the totals, not as chips
          ORDER BY e.computed_at`,
      )
      .all(user.id) as {
      pick_id: number;
      type: "milestone" | "weekly_growth" | "early_bird" | "stall";
      milestone_value: number | null;
      points: number;
      computed_at: string;
    }[];
    const eventsByPick = new Map<number, typeof eventRows>();
    for (const e of eventRows) {
      const list = eventsByPick.get(e.pick_id) ?? [];
      list.push(e);
      eventsByPick.set(e.pick_id, list);
    }

    const streak = db
      .prepare("SELECT current_streak, longest_streak FROM streaks WHERE user_id = ?")
      .get(user.id) as { current_streak: number; longest_streak: number } | undefined;

    const withEvents = picks.map((p) => ({
      ...p,
      events: (eventsByPick.get(p.id) ?? []).map((e) => ({
        type: e.type,
        milestoneValue: e.milestone_value,
        points: e.points,
        at: e.computed_at,
      })),
    }));
    const best = [...withEvents].sort((a, b) => b.points - a.points)[0] ?? null;

    return {
      user: { handle: user.handle, displayName: user.displayName, createdAt: user.createdAt },
      shelf,
      bestBadge,
      totalPoints,
      currentStreak: streak?.current_streak ?? 0,
      longestStreak: streak?.longest_streak ?? 0,
      bestPickId: best && best.points > 0 ? best.id : null,
      picks: withEvents,
    };
  });
}
