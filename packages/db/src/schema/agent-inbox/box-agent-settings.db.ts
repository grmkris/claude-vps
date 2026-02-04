import {
  type BoxAgentSettingsId,
  type BoxId,
  typeIdGenerator,
} from "@vps-claude/shared";
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
} from "drizzle-orm/pg-core";

import { baseEntityFields, typeId } from "../../utils/db-utils";
import { box } from "../box";

export const notificationModeEnum = pgEnum("notification_mode", [
  "gentle",
  "insistent",
]);

export type DeliveryMode = "spawn" | "notify";

export interface DeliveryConfig {
  email: DeliveryMode;
  cron: DeliveryMode;
  webhook: DeliveryMode;
  message: DeliveryMode;
}

export const DEFAULT_DELIVERY_CONFIG: DeliveryConfig = {
  email: "spawn",
  cron: "spawn",
  webhook: "notify",
  message: "notify",
};

export const boxAgentSettings = pgTable(
  "box_agent_settings",
  {
    id: typeId("boxAgentSettings", "id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("boxAgentSettings"))
      .$type<BoxAgentSettingsId>(),
    boxId: typeId("box", "box_id")
      .notNull()
      .references(() => box.id, { onDelete: "cascade" })
      .unique()
      .$type<BoxId>(),
    enabled: boolean("enabled").notNull().default(true),
    agentSecret: text("agent_secret").notNull(),
    identityName: text("identity_name"),
    notificationMode: notificationModeEnum("notification_mode")
      .notNull()
      .default("gentle"),
    deliveryConfig: jsonb("delivery_config")
      .$type<DeliveryConfig>()
      .notNull()
      .default(DEFAULT_DELIVERY_CONFIG),
    ...baseEntityFields,
  },
  (table) => [index("box_agent_settings_box_id_idx").on(table.boxId)]
);

export type BoxAgentSettings = typeof boxAgentSettings.$inferSelect;
export type NewBoxAgentSettings = typeof boxAgentSettings.$inferInsert;
