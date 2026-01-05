import { relations } from "drizzle-orm";

import { user } from "../auth";
import { userSecret } from "./user-secret.db";

export const userSecretRelations = relations(userSecret, ({ one }) => ({
  user: one(user, {
    fields: [userSecret.userId],
    references: [user.id],
  }),
}));
