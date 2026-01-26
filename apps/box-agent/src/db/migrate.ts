import { sqlite } from "./client";

// Create sessions table directly (migrations don't work in compiled binary)
// Schema matches: contextType, contextId as composite primary key
// Timestamps are INTEGER (Unix epoch) for Drizzle timestamp mode
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

console.log("Database migrations complete");
