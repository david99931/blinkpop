import type { User } from "@firstfan/shared";
import { getDb, inTransaction } from "../db/db.ts";
import { simNow } from "../sim/clock.ts";

export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

interface UserRow {
  id: number;
  handle: string;
  display_name: string;
  email: string;
  tz: string;
  created_at: string;
}

function toUser(r: UserRow): User {
  return {
    id: r.id,
    handle: r.handle,
    displayName: r.display_name,
    email: r.email,
    tz: r.tz,
    createdAt: r.created_at,
  };
}

export function createUser(input: {
  handle: string;
  displayName?: string;
  email: string;
  tz?: string;
  /** scrypt hash from domain/auth.ts; omit only for tests/seed accounts. */
  passwordHash?: string;
}): User {
  const handle = input.handle.toLowerCase().trim();
  if (!HANDLE_RE.test(handle)) {
    throw new DomainError("invalid_handle", "Handle must be 3–20 chars: a–z, 0–9, _");
  }
  // NOTE(anti-gaming, spec §10): rate-limiting account creation per IP/email
  // domain belongs here when this goes multi-user; not built for local MVP.
  return inTransaction((db) => {
    try {
      const res = db
        .prepare(
          "INSERT INTO users (handle, display_name, email, tz, created_at, password_hash) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          handle,
          input.displayName?.trim() || handle,
          input.email.toLowerCase().trim(),
          input.tz ?? "UTC",
          simNow().toISOString(),
          input.passwordHash ?? null,
        );
      const row = db
        .prepare("SELECT * FROM users WHERE id = ?")
        .get(Number(res.lastInsertRowid)) as unknown as UserRow;
      return toUser(row);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("users.handle")) throw new DomainError("handle_taken", "Handle is taken");
      if (msg.includes("users.email")) throw new DomainError("email_taken", "Email already registered");
      throw err;
    }
  });
}

export function getUserById(id: number): User | null {
  const row = getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as
    | unknown
    | undefined;
  return row ? toUser(row as UserRow) : null;
}

export function getUserByHandle(handle: string): User | null {
  const row = getDb()
    .prepare("SELECT * FROM users WHERE handle = ?")
    .get(handle.toLowerCase()) as unknown | undefined;
  return row ? toUser(row as UserRow) : null;
}

export function listUsers(): User[] {
  const rows = getDb().prepare("SELECT * FROM users ORDER BY id").all() as unknown[];
  return (rows as UserRow[]).map(toUser);
}
