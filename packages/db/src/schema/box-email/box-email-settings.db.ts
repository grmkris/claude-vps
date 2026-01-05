import {
  type BoxEmailSettingsId,
  type BoxId,
  typeIdGenerator,
} from "@vps-claude/shared";
import { boolean, index, pgTable, text } from "drizzle-orm/pg-core";

import { baseEntityFields, typeId } from "../../utils/db-utils";
import { box } from "../box";

export const boxEmailSettings = pgTable(
  "box_email_settings",
  {
    id: typeId("boxEmailSettings", "id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("boxEmailSettings"))
      .$type<BoxEmailSettingsId>(),
    boxId: typeId("box", "box_id")
      .notNull()
      .references(() => box.id, { onDelete: "cascade" })
      .unique()
      .$type<BoxId>(),
    enabled: boolean("enabled").notNull().default(true),
    agentSecret: text("agent_secret").notNull(),
    ...baseEntityFields,
  },
  (table) => [index("box_email_settings_boxId_idx").on(table.boxId)]
);

export type BoxEmailSettings = typeof boxEmailSettings.$inferSelect;
export type NewBoxEmailSettings = typeof boxEmailSettings.$inferInsert;
