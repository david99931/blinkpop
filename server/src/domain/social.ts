import { getDb, inTransaction } from "../db/db.ts";
import { simNow } from "../sim/clock.ts";
import { DomainError, getUserByHandle } from "./users.ts";

export function follow(followerId: number, followeeHandle: string): { followed: boolean } {
  const followee = getUserByHandle(followeeHandle);
  if (!followee) throw new DomainError("unknown_user", "No such user");
  if (followee.id === followerId) throw new DomainError("self_follow", "You can't follow yourself");
  return inTransaction((db) => {
    const existing = db
      .prepare("SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?")
      .get(followerId, followee.id);
    if (existing) return { followed: false };
    const now = simNow().toISOString();
    db.prepare("INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)").run(
      followerId,
      followee.id,
      now,
    );
    const follower = db.prepare("SELECT handle FROM users WHERE id = ?").get(followerId) as {
      handle: string;
    };
    db.prepare(
      "INSERT INTO notifications (user_id, type, payload, created_at) VALUES (?, 'new_follower', ?, ?)",
    ).run(followee.id, JSON.stringify({ followerId, followerHandle: follower.handle }), now);
    return { followed: true };
  });
}

export function unfollow(followerId: number, followeeHandle: string): { unfollowed: boolean } {
  const followee = getUserByHandle(followeeHandle);
  if (!followee) throw new DomainError("unknown_user", "No such user");
  const res = getDb()
    .prepare("DELETE FROM follows WHERE follower_id = ? AND followee_id = ?")
    .run(followerId, followee.id);
  return { unfollowed: res.changes > 0 };
}

export function followeeIds(userId: number): number[] {
  const rows = getDb()
    .prepare("SELECT followee_id FROM follows WHERE follower_id = ?")
    .all(userId) as { followee_id: number }[];
  return rows.map((r) => r.followee_id);
}
