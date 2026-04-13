import Database from "better-sqlite3";

import { getStateDbPath } from "@/lib/hermes-env";

let instance: Database.Database | null = null;

/**
 * Return a singleton better-sqlite3 connection to the Hermes state DB.
 *
 * - Singleton: one connection per Node.js process, shared across route handlers.
 * - WAL mode: concurrent reads while hermes CLI may be writing.
 * - Synchronous API: better-sqlite3's core advantage over callback-based alternatives.
 */
export function getDb(): Database.Database {
  if (instance) return instance;

  const db = new Database(getStateDbPath());
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  instance = db;
  return db;
}

/** Close the singleton connection. Call during graceful shutdown if needed. */
export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
