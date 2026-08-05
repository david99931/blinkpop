import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

let db: DatabaseSync | null = null;

/** Open (or reuse) the app database. Pass ":memory:" via FIRSTFAN_DB for tests. */
export function getDb(): DatabaseSync {
  if (!db) {
    // Env is read here (not at module load) so tests can set FIRSTFAN_DB first.
    // Each mode gets its own world: sim picks and real picks never mix.
    // (env check inlined rather than importing clock.ts — avoids an import cycle)
    const defaultFile =
      process.env.FIRSTFAN_PROVIDER === "soundcloud" ? "firstfan-live.db" : "firstfan.db";
    const dbPath = process.env.FIRSTFAN_DB ?? path.join(serverRoot, defaultFile);
    db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/** Run fn inside a transaction; rolls back on throw. */
export function inTransaction<T>(fn: (db: DatabaseSync) => T): T {
  const d = getDb();
  d.exec("BEGIN");
  try {
    const result = fn(d);
    d.exec("COMMIT");
    return result;
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }
}
