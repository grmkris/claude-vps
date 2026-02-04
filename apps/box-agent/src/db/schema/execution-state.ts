import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const executionState = sqliteTable("execution_state", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionFile: text("session_file").notNull().unique(),
  sessionId: text("session_id"),
  status: text("status").notNull().default("running"),
  startedAt: integer("started_at").notNull(),
  lastActivityAt: integer("last_activity_at").notNull(),
  messageCount: integer("message_count").notNull().default(0),
});

export type ExecutionState = typeof executionState.$inferSelect;
export type NewExecutionState = typeof executionState.$inferInsert;
