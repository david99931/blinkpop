import type { FastifyInstance } from "fastify";
import { getDb } from "../db/db.ts";
import { simNow } from "../sim/clock.ts";
import { domainErrorToReply, requireUser } from "./users.ts";

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/notifications", async (req, reply) => {
    try {
      const user = requireUser(req);
      const db = getDb();
      const rows = db
        .prepare(
          "SELECT id, type, payload, created_at, read_at FROM notifications " +
            "WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50",
        )
        .all(user.id) as {
        id: number;
        type: string;
        payload: string;
        created_at: string;
        read_at: string | null;
      }[];
      const unread = db
        .prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL")
        .get(user.id) as { n: number };
      return {
        unreadCount: unread.n,
        notifications: rows.map((r) => ({
          id: r.id,
          type: r.type,
          payload: JSON.parse(r.payload) as Record<string, unknown>,
          createdAt: r.created_at,
          readAt: r.read_at,
        })),
      };
    } catch (err) {
      const mapped = domainErrorToReply(err);
      if (mapped) return reply.code(mapped.status).send(mapped.body);
      throw err;
    }
  });

  app.post("/api/notifications/read", async (req, reply) => {
    try {
      const user = requireUser(req);
      const res = getDb()
        .prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL")
        .run(simNow().toISOString(), user.id);
      return { marked: res.changes };
    } catch (err) {
      const mapped = domainErrorToReply(err);
      if (mapped) return reply.code(mapped.status).send(mapped.body);
      throw err;
    }
  });
}
