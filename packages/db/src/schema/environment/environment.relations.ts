import { relations } from "drizzle-orm";

import { user } from "../auth";
import { environment } from "./environment.db";

export const environmentRelations = relations(environment, ({ one }) => ({
  user: one(user, {
    fields: [environment.userId],
    references: [user.id],
  }),
}));
