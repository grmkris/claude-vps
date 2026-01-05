import {
  typeIdGenerator,
  type UserId,
  type UserSecretId,
} from "@vps-claude/shared";
import { pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import { baseEntityFields, typeId } from "../../utils/db-utils";
import { user } from "../auth";

export const userSecret = pgTable(
  "user_secret",
  {
    id: typeId("userSecret", "id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("userSecret"))
      .$type<UserSecretId>(),
    userId: typeId("user", "user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" })
      .$type<UserId>(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    ...baseEntityFields,
  },
  (table) => [uniqueIndex("user_secret_unique_idx").on(table.userId, table.key)]
);

export type UserSecret = typeof userSecret.$inferSelect;
export type NewUserSecret = typeof userSecret.$inferInsert;
