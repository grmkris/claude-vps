import type { z } from "zod";

import { SkillId, UserId } from "@vps-claude/shared";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

import { skill } from "./skill.db";

export const SelectSkillSchema = createSelectSchema(skill, {
  id: SkillId,
  userId: UserId.nullable(),
});
export type SelectSkillSchema = z.infer<typeof SelectSkillSchema>;

export const InsertSkillSchema = createInsertSchema(skill).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSkillSchema = z.infer<typeof InsertSkillSchema>;
