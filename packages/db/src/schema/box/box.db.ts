import { type BoxId, typeIdGenerator, type UserId } from "@vps-claude/shared";
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { baseEntityFields, typeId } from "../../utils/db-utils";
import { user } from "../auth";

export const boxStatusEnum = pgEnum("box_status", [
  "pending",
  "deploying",
  "running",
  "stopped",
  "error",
  "deleted",
]);

export const providerTypeEnum = pgEnum("provider_type", ["sprites", "docker"]);

export const box = pgTable(
  "box",
  {
    id: typeId("box", "id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("box"))
      .$type<BoxId>(),
    name: text("name").notNull(),
    subdomain: text("subdomain").notNull().unique(),
    status: boxStatusEnum("status").notNull().default("pending"),

    // Provider configuration
    provider: providerTypeEnum("provider").notNull().default("sprites"),
    providerHostId: text("provider_host_id"),
    instanceName: text("instance_name"),
    instanceUrl: text("instance_url"),

    // Sprites-specific fields
    lastCheckpointId: text("last_checkpoint_id"),
    passwordHash: text("password_hash"),
    errorMessage: text("error_message"),
    lastHealthCheck: timestamp("last_health_check"),

    // Tailscale connection info
    tailscaleIp: text("tailscale_ip"),

    skills: text("skills").array().notNull().default([]),
    deploymentAttempt: integer("deployment_attempt").notNull().default(1),

    userId: typeId("user", "user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" })
      .$type<UserId>(),
    ...baseEntityFields,
  },
  (table) => [
    index("box_userId_idx").on(table.userId),
    index("box_subdomain_idx").on(table.subdomain),
    index("box_status_idx").on(table.status),
    index("box_provider_idx").on(table.provider),
  ]
);

export type Box = typeof box.$inferSelect;
export type NewBox = typeof box.$inferInsert;
