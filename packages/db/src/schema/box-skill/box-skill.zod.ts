import type { z } from "zod";

import { BoxId, BoxSkillId, SkillId } from "@vps-claude/shared";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

import { boxSkill } from "./box-skill.db";

export const SelectBoxSkillSchema = createSelectSchema(boxSkill, {
  id: BoxSkillId,
  boxId: BoxId,
  skillId: SkillId,
});
export type SelectBoxSkillSchema = z.infer<typeof SelectBoxSkillSchema>;

export const InsertBoxSkillSchema = createInsertSchema(boxSkill).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBoxSkillSchema = z.infer<typeof InsertBoxSkillSchema>;
