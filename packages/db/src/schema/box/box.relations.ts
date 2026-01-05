import { relations } from "drizzle-orm";

import { user } from "../auth";
import { boxEmail, boxEmailSettings } from "../box-email";
import { boxSkill } from "../box-skill";
import { box } from "./box.db";

export const boxRelations = relations(box, ({ one, many }) => ({
  user: one(user, {
    fields: [box.userId],
    references: [user.id],
  }),
  boxSkills: many(boxSkill),
  boxEmails: many(boxEmail),
  boxEmailSettings: one(boxEmailSettings, {
    fields: [box.id],
    references: [boxEmailSettings.boxId],
  }),
}));
