import { BoxCronjobExecutionId, BoxCronjobId, BoxId } from "@vps-claude/shared";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

import {
  boxCronjob,
  boxCronjobExecution,
  boxCronjobExecutionStatusEnum,
} from "./box-cronjob.db";

export const SelectBoxCronjobSchema = createSelectSchema(boxCronjob, {
  id: BoxCronjobId,
  boxId: BoxId,
});
export type SelectBoxCronjobSchema = z.infer<typeof SelectBoxCronjobSchema>;

export const InsertBoxCronjobSchema = createInsertSchema(boxCronjob).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBoxCronjobSchema = z.infer<typeof InsertBoxCronjobSchema>;

export const SelectBoxCronjobExecutionSchema = createSelectSchema(
  boxCronjobExecution,
  {
    id: BoxCronjobExecutionId,
    cronjobId: BoxCronjobId,
  }
);
export type SelectBoxCronjobExecutionSchema = z.infer<
  typeof SelectBoxCronjobExecutionSchema
>;

export const InsertBoxCronjobExecutionSchema = createInsertSchema(
  boxCronjobExecution
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBoxCronjobExecutionSchema = z.infer<
  typeof InsertBoxCronjobExecutionSchema
>;

export const BOX_CRONJOB_EXECUTION_STATUSES =
  boxCronjobExecutionStatusEnum.enumValues;
export const BoxCronjobExecutionStatus = z.enum(BOX_CRONJOB_EXECUTION_STATUSES);
export type BoxCronjobExecutionStatus = z.infer<
  typeof BoxCronjobExecutionStatus
>;
