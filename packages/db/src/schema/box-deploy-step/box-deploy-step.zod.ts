import { BoxDeployStepId, BoxId } from "@vps-claude/shared";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

import { boxDeployStep, boxDeployStepStatusEnum } from "./box-deploy-step.db";

export const SelectBoxDeployStepSchema = createSelectSchema(boxDeployStep, {
  id: BoxDeployStepId,
  boxId: BoxId,
  parentId: BoxDeployStepId.nullable(),
});
export type SelectBoxDeployStepSchema = z.infer<
  typeof SelectBoxDeployStepSchema
>;

export const InsertSelectBoxDeployStepSchema = createInsertSchema(
  boxDeployStep
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSelectBoxDeployStepSchema = z.infer<
  typeof InsertSelectBoxDeployStepSchema
>;

export const BOX_DEPLOY_STEP_STATUSES = boxDeployStepStatusEnum.enumValues;
export const BoxDeployStepStatus = z.enum(BOX_DEPLOY_STEP_STATUSES);
export type BoxDeployStepStatus = z.infer<typeof BoxDeployStepStatus>;
