import {
  typeIdGenerator,
  type UserId,
  type UserCredentialId,
} from "@vps-claude/shared";
import { pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import { baseEntityFields, typeId } from "../../utils/db-utils";
import { user } from "../auth";

export const userCredential = pgTable(
  "user_credential",
  {
    id: typeId("userCredential", "id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("userCredential"))
      .$type<UserCredentialId>(),
    userId: typeId("user", "user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" })
      .$type<UserId>(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    ...baseEntityFields,
  },
  (table) => [
    uniqueIndex("user_credential_unique_idx").on(table.userId, table.key),
  ]
);

export type UserCredential = typeof userCredential.$inferSelect;
export type NewUserCredential = typeof userCredential.$inferInsert;
