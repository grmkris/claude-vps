import {
  type BoxEnvVarId,
  type BoxId,
  typeIdGenerator,
} from "@vps-claude/shared";
import { pgEnum, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import { baseEntityFields, typeId } from "../../utils/db-utils";
import { box } from "./box.db";

export const boxEnvVarTypeEnum = pgEnum("box_env_var_type", [
  "literal",
  "credential_ref",
]);

export const boxEnvVar = pgTable(
  "box_env_var",
  {
    id: typeId("boxEnvVar", "id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("boxEnvVar"))
      .$type<BoxEnvVarId>(),
    boxId: typeId("box", "box_id")
      .notNull()
      .references(() => box.id, { onDelete: "cascade" })
      .$type<BoxId>(),
    key: text("key").notNull(),
    type: boxEnvVarTypeEnum("type").notNull(),
    value: text("value"),
    credentialKey: text("credential_key"),
    ...baseEntityFields,
  },
  (table) => [uniqueIndex("box_env_var_unique_idx").on(table.boxId, table.key)]
);

export type BoxEnvVar = typeof boxEnvVar.$inferSelect;
export type NewBoxEnvVar = typeof boxEnvVar.$inferInsert;
