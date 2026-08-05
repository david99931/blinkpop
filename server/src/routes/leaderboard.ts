import type { FastifyInstance } from "fastify";
import { getDb } from "../db/db.ts";
import { simNow } from "../sim/clock.ts";
import { followeeIds } from "../domain/social.ts";
import { domainErrorToReply, requireUser } from "./users.ts";

/** Season = calendar month of the (sim) clock (spec §8.5). */
export function seasonBounds(now: Date): { start: string; end: string; label: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1)).toISOString();
  const end = new Date(Date.UTC(y, m + 1, 1)).toISOString();
  const label = `${y}-${String(m + 1).padStart(2, "0")}`;
  return { start, end, label };
}

export interface LeaderboardRow {
  rank: number;
  userId: number;
  handle: string;
  displayName: string;
  points: number;
  picks: number;
}

export function leaderboard(opts: {
  period: "alltime" | "season";
  onlyUserIds?: number[];
  limit?: number;
}): { rows: LeaderboardRow[]; season?: string } {
  const db = getDb();
  const { period, onlyUserIds, limit = 100 } = opts;
  const season = seasonBounds(simNow());

  const seasonFilter = period === "season" ? "AND e.computed_at >= ? AND e.computed_at < ?" : "";
  const userFilter = onlyUserIds ? `WHERE u.id IN (${onlyUserIds.map(() => "?").join(",")})` : "";
  const params: (string | number)[] = [
    ...(period === "season" ? [season.start, season.end] : []),
    ...(onlyUserIds ?? []),
    limit,
  ];

  const rows = db
    .prepare(
      `SELECT u.id AS user_id, u.handle, u.display_name,
              COALESCE(SUM(e.points), 0) AS points,
              COUNT(DISTINCT p.id) AS picks
         FROM users u
         LEFT JOIN picks p ON p.user_id = u.id
         LEFT JOIN score_events e ON e.pick_id = p.id ${seasonFilter}
         ${userFilter}
        GROUP BY u.id
        ORDER BY points DESC, u.handle ASC
        LIMIT ?`,
    )
    .all(...params) as {
    user_id: number;
    handle: string;
    display_name: string;
    points: number;
    picks: number;
  }[];

  return {
    rows: rows.map((r, i) => ({
      rank: i + 1,
      userId: r.user_id,
      handle: r.handle,
      displayName: r.display_name,
      points: r.points,
      picks: r.picks,
    })),
    ...(period === "season" ? { season: season.label } : {}),
  };
}

export async function leaderboardRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { scope?: string; period?: string } }>(
    "/api/leaderboard",
    async (req, reply) => {
      const period = req.query.period === "season" ? "season" : "alltime";
      const scope = req.query.scope === "friends" ? "friends" : "global";
      try {
        if (scope === "friends") {
          const user = requireUser(req);
          return leaderboard({ period, onlyUserIds: [...followeeIds(user.id), user.id] });
        }
        return leaderboard({ period });
      } catch (err) {
        const mapped = domainErrorToReply(err);
        if (mapped) return reply.code(mapped.status).send(mapped.body);
        throw err;
      }
    },
  );
}
