import {
  type AiUsageId,
  type BoxId,
  typeIdGenerator,
  type UserId,
} from "@vps-claude/shared";
import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
} from "drizzle-orm/pg-core";

import { baseEntityFields, typeId } from "../../utils/db-utils";
import { user } from "../auth";
import { box } from "../box";

export const aiUsage = pgTable(
  "ai_usage",
  {
    id: typeId("aiUsage", "id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("aiUsage"))
      .$type<AiUsageId>(),
    userId: typeId("user", "user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" })
      .$type<UserId>(),
    boxId: typeId("box", "box_id")
      .references(() => box.id, { onDelete: "set null" })
      .$type<BoxId>(),

    // What was called
    provider: text("provider").notNull(), // "fal", "elevenlabs", "google", "replicate"
    capability: text("capability").notNull(), // "image_generation", "text_to_speech", etc.
    modelId: text("model_id"), // "fal-ai/flux/dev"

    // Usage metrics
    inputUnits: integer("input_units"), // characters, seconds, pixels
    outputUnits: integer("output_units"),
    unitType: text("unit_type"), // "characters", "seconds", "megapixels"

    // Cost tracking (platform cost)
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),

    // Metadata
    durationMs: integer("duration_ms"),
    success: boolean("success").default(true),
    errorMessage: text("error_message"),

    ...baseEntityFields,
  },
  (table) => [
    index("ai_usage_user_id_idx").on(table.userId),
    index("ai_usage_box_id_idx").on(table.boxId),
    index("ai_usage_provider_idx").on(table.provider),
    index("ai_usage_capability_idx").on(table.capability),
    index("ai_usage_created_at_idx").on(table.createdAt),
  ]
);

export type AiUsage = typeof aiUsage.$inferSelect;
export type NewAiUsage = typeof aiUsage.$inferInsert;
