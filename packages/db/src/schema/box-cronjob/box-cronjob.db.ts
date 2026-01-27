import {
  type BoxCronjobExecutionId,
  type BoxCronjobId,
  type BoxId,
  typeIdGenerator,
} from "@vps-claude/shared";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
} from "drizzle-orm/pg-core";

import {
  baseEntityFields,
  createTimestampField,
  typeId,
} from "../../utils/db-utils";
import { box } from "../box";

export const boxCronjobExecutionStatusEnum = pgEnum(
  "box_cronjob_execution_status",
  ["pending", "waking_box", "running", "completed", "failed"]
);

export const boxCronjob = pgTable(
  "box_cronjob",
  {
    id: typeId("boxCronjob", "id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("boxCronjob"))
      .$type<BoxCronjobId>(),
    boxId: typeId("box", "box_id")
      .notNull()
      .references(() => box.id, { onDelete: "cascade" })
      .$type<BoxId>(),
    name: text("name").notNull(),
    description: text("description"),
    schedule: text("schedule").notNull(),
    prompt: text("prompt").notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    enabled: boolean("enabled").notNull().default(true),
    bullmqJobKey: text("bullmq_job_key"),
    lastRunAt: createTimestampField("last_run_at"),
    nextRunAt: createTimestampField("next_run_at"),
    ...baseEntityFields,
  },
  (table) => [
    index("box_cronjob_box_id_idx").on(table.boxId),
    index("box_cronjob_enabled_idx").on(table.enabled),
    index("box_cronjob_next_run_at_idx").on(table.nextRunAt),
  ]
);

export const boxCronjobExecution = pgTable(
  "box_cronjob_execution",
  {
    id: typeId("boxCronjobExecution", "id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("boxCronjobExecution"))
      .$type<BoxCronjobExecutionId>(),
    cronjobId: typeId("boxCronjob", "cronjob_id")
      .notNull()
      .references(() => boxCronjob.id, { onDelete: "cascade" })
      .$type<BoxCronjobId>(),
    status: boxCronjobExecutionStatusEnum("status")
      .notNull()
      .default("pending"),
    startedAt: createTimestampField("started_at").defaultNow().notNull(),
    completedAt: createTimestampField("completed_at"),
    durationMs: integer("duration_ms"),
    errorMessage: text("error_message"),
    result: text("result"),
    ...baseEntityFields,
  },
  (table) => [
    index("box_cronjob_execution_cronjob_id_idx").on(table.cronjobId),
    index("box_cronjob_execution_status_idx").on(table.status),
    index("box_cronjob_execution_started_at_idx").on(table.startedAt),
  ]
);

export type BoxCronjob = typeof boxCronjob.$inferSelect;
export type NewBoxCronjob = typeof boxCronjob.$inferInsert;

export type BoxCronjobExecution = typeof boxCronjobExecution.$inferSelect;
export type NewBoxCronjobExecution = typeof boxCronjobExecution.$inferInsert;
