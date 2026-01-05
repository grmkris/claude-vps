import { relations } from "drizzle-orm";

import { userSecret } from "../secret";
import { skill } from "../skill";
import { account, session, user } from "./auth.db";

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  userSecrets: many(userSecret),
  skills: many(skill),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));
