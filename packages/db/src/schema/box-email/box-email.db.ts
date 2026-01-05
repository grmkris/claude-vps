import {
  type BoxEmailId,
  type BoxId,
  typeIdGenerator,
} from "@vps-claude/shared";
import { index, pgEnum, pgTable, text } from "drizzle-orm/pg-core";

import { createTimestampField, typeId } from "../../utils/db-utils";
import { box } from "../box";

export const boxEmailStatusEnum = pgEnum("box_email_status", [
  "received",
  "delivered",
  "failed",
]);

export const boxEmail = pgTable(
  "box_email",
  {
    id: typeId("boxEmail", "id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("boxEmail"))
      .$type<BoxEmailId>(),
    boxId: typeId("box", "box_id")
      .notNull()
      .references(() => box.id, { onDelete: "cascade" })
      .$type<BoxId>(),
    emailMessageId: text("email_message_id").notNull(),
    fromEmail: text("from_email").notNull(),
    fromName: text("from_name"),
    toEmail: text("to_email").notNull(),
    subject: text("subject"),
    textBody: text("text_body"),
    htmlBody: text("html_body"),
    rawEmail: text("raw_email"),
    status: boxEmailStatusEnum("status").notNull().default("received"),
    errorMessage: text("error_message"),
    receivedAt: createTimestampField("received_at").defaultNow().notNull(),
    deliveredAt: createTimestampField("delivered_at"),
    createdAt: createTimestampField("created_at").defaultNow().notNull(),
    updatedAt: createTimestampField("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("box_email_box_id_idx").on(table.boxId),
    index("box_email_status_idx").on(table.status),
    index("box_email_received_at_idx").on(table.receivedAt),
  ]
);

export type BoxEmail = typeof boxEmail.$inferSelect;
export type NewBoxEmail = typeof boxEmail.$inferInsert;
