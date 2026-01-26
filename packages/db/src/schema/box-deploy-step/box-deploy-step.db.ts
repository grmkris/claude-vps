import {
  type BoxDeployStepId,
  type BoxId,
  typeIdGenerator,
} from "@vps-claude/shared";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
} from "drizzle-orm/pg-core";

import { createTimestampField, typeId } from "../../utils/db-utils";
import { box } from "../box";

export const boxDeployStepStatusEnum = pgEnum("box_deploy_step_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
]);

export const boxDeployStep = pgTable(
  "box_deploy_step",
  {
    id: typeId("boxDeployStep", "id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("boxDeployStep"))
      .$type<BoxDeployStepId>(),
    boxId: typeId("box", "box_id")
      .notNull()
      .references(() => box.id, { onDelete: "cascade" })
      .$type<BoxId>(),
    deploymentAttempt: integer("deployment_attempt").notNull().default(1),
    parentId: typeId("boxDeployStep", "parent_id").$type<BoxDeployStepId>(),
    stepKey: text("step_key").notNull(),
    stepOrder: integer("step_order").notNull(),
    name: text("name").notNull(),
    status: boxDeployStepStatusEnum("status").notNull().default("pending"),
    startedAt: createTimestampField("started_at"),
    completedAt: createTimestampField("completed_at"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: createTimestampField("created_at").defaultNow().notNull(),
    updatedAt: createTimestampField("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("box_deploy_step_box_id_idx").on(table.boxId),
    index("box_deploy_step_box_attempt_idx").on(
      table.boxId,
      table.deploymentAttempt
    ),
    index("box_deploy_step_status_idx").on(table.status),
    index("box_deploy_step_parent_id_idx").on(table.parentId),
  ]
);

export type BoxDeployStep = typeof boxDeployStep.$inferSelect;
export type NewBoxDeployStep = typeof boxDeployStep.$inferInsert;
