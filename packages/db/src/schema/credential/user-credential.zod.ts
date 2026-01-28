import type { z } from "zod";

import { UserCredentialId, UserId } from "@vps-claude/shared";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

import { userCredential } from "./user-credential.db";

export const SelectUserCredentialSchema = createSelectSchema(userCredential, {
  id: UserCredentialId,
  userId: UserId,
});
export type SelectUserCredentialSchema = z.infer<
  typeof SelectUserCredentialSchema
>;

export const InsertUserCredentialSchema = createInsertSchema(
  userCredential
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUserCredentialSchema = z.infer<
  typeof InsertUserCredentialSchema
>;
