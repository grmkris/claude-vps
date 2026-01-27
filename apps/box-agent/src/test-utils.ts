import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

import * as schema from "./db/schema";

export interface BoxAgentTestDb {
  db: BunSQLiteDatabase<typeof schema>;
  sqlite: Database;
  close: () => void;
}

/**
 * Creates an in-memory SQLite database for testing.
 * Uses the same schema as production but without file persistence.
 */
export function createBoxAgentTestDb(): BoxAgentTestDb {
  const sqlite = new Database(":memory:");

  // Create sessions table (same SQL as migrate.ts)
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      context_type TEXT NOT NULL,
      context_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (context_type, context_id)
    )
  `);

  const db = drizzle(sqlite, { schema });

  return {
    db,
    sqlite,
    close: () => sqlite.close(),
  };
}
