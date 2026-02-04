import {
  type AgentInboxId,
  type AgentInboxNotificationId,
  type BoxId,
  typeIdGenerator,
} from "@vps-claude/shared";
import { index, pgEnum, pgTable, text } from "drizzle-orm/pg-core";

import { createTimestampField, typeId } from "../../utils/db-utils";
import { box } from "../box";
import { agentInbox } from "./agent-inbox.db";

export const agentInboxNotificationStatusEnum = pgEnum(
  "agent_inbox_notification_status",
  ["unread", "read"]
);

export const agentInboxNotification = pgTable(
  "agent_inbox_notification",
  {
    id: typeId("agentInboxNotification", "id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("agentInboxNotification"))
      .$type<AgentInboxNotificationId>(),
    inboxId: typeId("agentInbox", "inbox_id")
      .notNull()
      .references(() => agentInbox.id, { onDelete: "cascade" })
      .$type<AgentInboxId>(),
    targetBoxId: typeId("box", "target_box_id")
      .notNull()
      .references(() => box.id, { onDelete: "cascade" })
      .$type<BoxId>(),
    // Session targeting: "contextType:contextId" format, null = all sessions
    targetSessionKey: text("target_session_key"),
    status: agentInboxNotificationStatusEnum("status")
      .notNull()
      .default("unread"),
    readAt: createTimestampField("read_at"),
    createdAt: createTimestampField("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("agent_inbox_notification_inbox_id_idx").on(table.inboxId),
    index("agent_inbox_notification_target_box_id_idx").on(table.targetBoxId),
    index("agent_inbox_notification_status_idx").on(table.status),
    index("agent_inbox_notification_session_key_idx").on(
      table.targetSessionKey
    ),
  ]
);

export type AgentInboxNotification = typeof agentInboxNotification.$inferSelect;
export type NewAgentInboxNotification =
  typeof agentInboxNotification.$inferInsert;
