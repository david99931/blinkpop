import type { FastifyInstance } from "fastify";
import { underdogTierFor } from "@firstfan/shared";
import { getDb } from "../db/db.ts";
import { follow, followeeIds, unfollow } from "../domain/social.ts";
import { domainErrorToReply, requireUser } from "./users.ts";

/** The feed doubles as music discovery (spec §8.4): every card links a track. */
export interface FeedItem {
  kind: "pick" | "score";
  at: string;
  handle: string;
  displayName: string;
  title: string;
  artistName: string;
  providerTrackId: string;
  // pick cards
  baselinePlays?: number | null;
  tierLabel?: string | null;
  superPick?: boolean;
  // score cards
  eventType?: "milestone" | "weekly_growth" | "early_bird";
  milestoneValue?: number | null;
  points?: number;
}

export function buildFeed(userId: number, limit = 50): FeedItem[] {
  const db = getDb();
  const ids = [...followeeIds(userId), userId];
  const placeholders = ids.map(() => "?").join(",");

  const pickRows = db
    .prepare(
      `SELECT p.picked_at AS at, p.kind, u.handle, u.display_name, t.title, t.artist_name,
              t.provider_track_id, base.plays AS baseline_plays
         FROM picks p
         JOIN users u ON u.id = p.user_id
         JOIN tracks t ON t.id = p.track_id
         JOIN track_snapshots base ON base.id = p.baseline_snapshot_id
        WHERE p.user_id IN (${placeholders})
        ORDER BY p.picked_at DESC LIMIT ?`,
    )
    .all(...ids, limit) as {
    at: string;
    kind: "daily" | "super";
    handle: string;
    display_name: string;
    title: string;
    artist_name: string;
    provider_track_id: string;
    baseline_plays: number | null;
  }[];

  const scoreRows = db
    .prepare(
      `SELECT e.computed_at AS at, e.type AS event_type, e.milestone_value, e.points,
              u.handle, u.display_name, t.title, t.artist_name, t.provider_track_id
         FROM score_events e
         JOIN picks p ON p.id = e.pick_id
         JOIN users u ON u.id = p.user_id
         JOIN tracks t ON t.id = p.track_id
        WHERE p.user_id IN (${placeholders})
        ORDER BY e.computed_at DESC LIMIT ?`,
    )
    .all(...ids, limit) as {
    at: string;
    event_type: "milestone" | "weekly_growth" | "early_bird";
    milestone_value: number | null;
    points: number;
    handle: string;
    display_name: string;
    title: string;
    artist_name: string;
    provider_track_id: string;
  }[];

  const items: FeedItem[] = [
    ...pickRows.map(
      (r): FeedItem => ({
        kind: "pick",
        at: r.at,
        handle: r.handle,
        displayName: r.display_name,
        title: r.title,
        artistName: r.artist_name,
        providerTrackId: r.provider_track_id,
        baselinePlays: r.baseline_plays,
        tierLabel: r.baseline_plays === null ? null : underdogTierFor(r.baseline_plays).label,
        superPick: r.kind === "super",
      }),
    ),
    ...scoreRows.map(
      (r): FeedItem => ({
        kind: "score",
        at: r.at,
        handle: r.handle,
        displayName: r.display_name,
        title: r.title,
        artistName: r.artist_name,
        providerTrackId: r.provider_track_id,
        eventType: r.event_type,
        milestoneValue: r.milestone_value,
        points: r.points,
      }),
    ),
  ];
  return items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
}

export async function socialRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { handle?: string } }>("/api/follows", async (req, reply) => {
    try {
      const user = requireUser(req);
      if (!req.body?.handle) {
        return reply.code(400).send({ error: "bad_request", message: "handle required" });
      }
      return follow(user.id, req.body.handle);
    } catch (err) {
      const mapped = domainErrorToReply(err);
      if (mapped) return reply.code(mapped.status).send(mapped.body);
      throw err;
    }
  });

  app.delete<{ Params: { handle: string } }>("/api/follows/:handle", async (req, reply) => {
    try {
      const user = requireUser(req);
      return unfollow(user.id, req.params.handle);
    } catch (err) {
      const mapped = domainErrorToReply(err);
      if (mapped) return reply.code(mapped.status).send(mapped.body);
      throw err;
    }
  });

  app.get("/api/follows/me", async (req, reply) => {
    try {
      const user = requireUser(req);
      const rows = getDb()
        .prepare(
          "SELECT u.handle FROM follows f JOIN users u ON u.id = f.followee_id WHERE f.follower_id = ?",
        )
        .all(user.id) as { handle: string }[];
      return { following: rows.map((r) => r.handle) };
    } catch (err) {
      const mapped = domainErrorToReply(err);
      if (mapped) return reply.code(mapped.status).send(mapped.body);
      throw err;
    }
  });

  app.get("/api/feed", async (req, reply) => {
    try {
      const user = requireUser(req);
      return { items: buildFeed(user.id) };
    } catch (err) {
      const mapped = domainErrorToReply(err);
      if (mapped) return reply.code(mapped.status).send(mapped.body);
      throw err;
    }
  });
}
