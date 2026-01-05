import { relations } from "drizzle-orm";

import { box } from "../box";
import { skill } from "../skill";
import { boxSkill } from "./box-skill.db";

export const boxSkillRelations = relations(boxSkill, ({ one }) => ({
  box: one(box, {
    fields: [boxSkill.boxId],
    references: [box.id],
  }),
  skill: one(skill, {
    fields: [boxSkill.skillId],
    references: [skill.id],
  }),
}));
