import { relations } from "drizzle-orm";

import { user } from "../auth";
import { userCredential } from "./user-credential.db";

export const userCredentialRelations = relations(userCredential, ({ one }) => ({
  user: one(user, {
    fields: [userCredential.userId],
    references: [user.id],
  }),
}));
