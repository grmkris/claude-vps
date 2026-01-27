import type { z } from "zod";

import { BoxEnvVarId, BoxId } from "@vps-claude/shared";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

import { boxEnvVar } from "./box-env-var.db";

export const SelectBoxEnvVarSchema = createSelectSchema(boxEnvVar, {
  id: BoxEnvVarId,
  boxId: BoxId,
});
export type SelectBoxEnvVarSchema = z.infer<typeof SelectBoxEnvVarSchema>;

export const InsertBoxEnvVarSchema = createInsertSchema(boxEnvVar).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBoxEnvVarSchema = z.infer<typeof InsertBoxEnvVarSchema>;
