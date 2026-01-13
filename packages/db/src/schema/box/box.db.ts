import { type BoxId, typeIdGenerator, type UserId } from "@vps-claude/shared";
import { index, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

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

    // Docker Engine fields
    dockerContainerId: text("docker_container_id"),
    containerName: text("container_name"),
    imageName: text("image_name"),

    // Metadata
    passwordHash: text("password_hash"),
    errorMessage: text("error_message"),
    lastHealthCheck: timestamp("last_health_check"),

    // Telegram integration
    telegramBotToken: text("telegram_bot_token"),
    telegramChatId: text("telegram_chat_id"),

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
  ]
);

export type Box = typeof box.$inferSelect;
export type NewBox = typeof box.$inferInsert;
