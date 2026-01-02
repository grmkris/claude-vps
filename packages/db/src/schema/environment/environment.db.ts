import { index, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { typeIdGenerator } from "@vps-claude/shared";
import { user } from "../auth";

export const environmentStatusEnum = pgEnum("environment_status", [
  "pending",
  "deploying",
  "running",
  "error",
  "deleted",
]);

export const environment = pgTable(
  "environment",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("environment")),
    name: text("name").notNull(),
    subdomain: text("subdomain").notNull().unique(),
    status: environmentStatusEnum("status").notNull().default("pending"),
    coolifyApplicationUuid: text("coolify_application_uuid"),
    errorMessage: text("error_message"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("environment_userId_idx").on(table.userId),
    index("environment_subdomain_idx").on(table.subdomain),
    index("environment_status_idx").on(table.status),
  ],
);

export type Environment = typeof environment.$inferSelect;
export type NewEnvironment = typeof environment.$inferInsert;
