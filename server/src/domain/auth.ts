/**
 * Password auth + bearer sessions. Zero new dependencies: scrypt from
 * node:crypto for hashing, random tokens hashed with sha256 in the DB.
 * The client stores the raw token (localStorage) and sends
 * `Authorization: Bearer <token>` — XSS-stealable in principle; acceptable
 * for the local MVP, revisit (httpOnly cookie) before public deploy.
 */

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { User } from "@firstfan/shared";
import { getDb, inTransaction } from "../db/db.ts";
import { simNow } from "../sim/clock.ts";
import { DomainError, getUserById } from "./users.ts";

const SCRYPT = { N: 16384, r: 8, p: 1, keyLen: 64 };
const SESSION_DAYS = 30;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, SCRYPT.keyLen, SCRYPT);
  return `scrypt:${SCRYPT.N}:${SCRYPT.r}:${SCRYPT.p}:${salt.toString("hex")}:${key.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltHex, keyHex] = parts;
  const expected = Buffer.from(keyHex!, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex!, "hex"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(actual, expected);
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function assertPasswordStrength(password: string): void {
  if (typeof password !== "string" || password.length < 8) {
    throw new DomainError("weak_password", "Password must be at least 8 characters");
  }
}

/** Create a session and return the RAW bearer token (shown once). */
export function createSession(userId: number): string {
  const token = randomBytes(32).toString("base64url");
  const now = simNow();
  getDb()
    .prepare(
      "INSERT INTO sessions (user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)",
    )
    .run(
      userId,
      tokenHash(token),
      now.toISOString(),
      new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString(),
    );
  return token;
}

export function resolveSession(token: string): User | null {
  const row = getDb()
    .prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?")
    .get(tokenHash(token)) as { user_id: number; expires_at: string } | undefined;
  if (!row) return null;
  if (row.expires_at < simNow().toISOString()) return null;
  return getUserById(row.user_id);
}

export function destroySession(token: string): void {
  getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
}

/**
 * Log in with handle OR email. Legacy accounts (created before auth existed,
 * password_hash NULL) are claimed by their first login: the password given
 * becomes theirs. Fine for local data; remove before any public deploy.
 */
export function login(identifier: string, password: string): { user: User; token: string } {
  assertPasswordStrength(password);
  const ident = identifier.trim().toLowerCase();
  return inTransaction((db) => {
    const row = db
      .prepare("SELECT id, password_hash FROM users WHERE handle = ? OR email = ?")
      .get(ident, ident) as { id: number; password_hash: string | null } | undefined;
    if (!row) throw new DomainError("invalid_credentials", "No account matches that login");
    if (row.password_hash === null) {
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
        hashPassword(password),
        row.id,
      );
    } else if (!verifyPassword(password, row.password_hash)) {
      throw new DomainError("invalid_credentials", "Wrong password");
    }
    const user = getUserById(row.id)!;
    return { user, token: createSession(row.id) };
  });
}
