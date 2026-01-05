import { relations } from "drizzle-orm";

import { user } from "../auth";
import { boxSkill } from "../box-skill";
import { skill } from "./skill.db";

export const skillRelations = relations(skill, ({ one, many }) => ({
  user: one(user, {
    fields: [skill.userId],
    references: [user.id],
  }),
  boxSkills: many(boxSkill),
}));
