import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";

import * as schema from "./schema";

const DB_PATH = "/home/coder/.box-agent/sessions.db";

const sqlite = new Database(DB_PATH, { create: true });

// Enable WAL mode for better performance
sqlite.run("PRAGMA journal_mode = WAL;");

// Create table if not exists (simple migration)
sqlite.run(`
  CREATE TABLE IF NOT EXISTS sessions (
    context_type TEXT NOT NULL,
    context_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (context_type, context_id)
  )
`);

export const db = drizzle(sqlite, { schema });
