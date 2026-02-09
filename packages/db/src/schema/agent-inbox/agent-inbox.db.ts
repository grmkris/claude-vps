import {
  type AgentInboxId,
  type BoxCronjobId,
  type BoxId,
  typeIdGenerator,
} from "@vps-claude/shared";
import { index, jsonb, pgEnum, pgTable, text } from "drizzle-orm/pg-core";

import { createTimestampField, typeId } from "../../utils/db-utils";
import { box } from "../box";

export const agentInboxTypeEnum = pgEnum("agent_inbox_type", [
  "email",
  "cron",
  "webhook",
  "message",
]);

export const agentInboxStatusEnum = pgEnum("agent_inbox_status", [
  "pending",
  "delivered",
  "read",
]);

export const agentInboxSourceTypeEnum = pgEnum("agent_inbox_source_type", [
  "external",
  "box",
  "system",
]);

/** Typed metadata — used on the Drizzle column and in services. */
export type AgentInboxMetadata = {
  // Email
  emailMessageId?: string;
  from?: { email: string; name?: string };
  to?: string;
  subject?: string;
  htmlBody?: string;
  inReplyTo?: string;
  // Cron
  cronJobId?: BoxCronjobId;
  cronSchedule?: string;
  // Webhook
  webhookId?: string;
  webhookPayload?: Record<string, unknown>;
  callbackUrl?: string;
  // Message
  title?: string;
  // Override delivery behavior
  spawnSession?: boolean;
};

export const agentInbox = pgTable(
  "agent_inbox",
  {
    id: typeId("agentInbox", "id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("agentInbox"))
      .$type<AgentInboxId>(),
    boxId: typeId("box", "box_id")
      .notNull()
      .references(() => box.id, { onDelete: "cascade" })
      .$type<BoxId>(),
    type: agentInboxTypeEnum("type").notNull(),
    status: agentInboxStatusEnum("status").notNull().default("pending"),
    content: text("content").notNull(),
    parentId: typeId("agentInbox", "parent_id").$type<AgentInboxId>(),

    // Source info
    sourceType: agentInboxSourceTypeEnum("source_type").notNull(),
    sourceBoxId: typeId("box", "source_box_id").$type<BoxId>(),
    sourceExternal: jsonb("source_external").$type<{
      email?: string;
      name?: string;
      webhookUrl?: string;
    }>(),

    // Type-specific metadata
    metadata: jsonb("metadata").$type<AgentInboxMetadata>(),

    // Timestamps
    createdAt: createTimestampField("created_at").defaultNow().notNull(),
    deliveredAt: createTimestampField("delivered_at"),
    readAt: createTimestampField("read_at"),
    updatedAt: createTimestampField("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("agent_inbox_box_id_idx").on(table.boxId),
    index("agent_inbox_type_idx").on(table.type),
    index("agent_inbox_status_idx").on(table.status),
    index("agent_inbox_created_at_idx").on(table.createdAt),
    index("agent_inbox_parent_id_idx").on(table.parentId),
    index("agent_inbox_source_box_id_idx").on(table.sourceBoxId),
  ]
);

export type AgentInbox = typeof agentInbox.$inferSelect;
export type NewAgentInbox = typeof agentInbox.$inferInsert;
