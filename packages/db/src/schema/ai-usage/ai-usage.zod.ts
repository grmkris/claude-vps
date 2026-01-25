import { AiUsageId, BoxId, UserId } from "@vps-claude/shared";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

import { aiUsage } from "./ai-usage.db";

export const SelectAiUsageSchema = createSelectSchema(aiUsage, {
  id: AiUsageId,
  userId: UserId,
  boxId: BoxId.nullable(),
});
export type SelectAiUsageSchema = z.infer<typeof SelectAiUsageSchema>;

export const InsertAiUsageSchema = createInsertSchema(aiUsage).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiUsageSchema = z.infer<typeof InsertAiUsageSchema>;
