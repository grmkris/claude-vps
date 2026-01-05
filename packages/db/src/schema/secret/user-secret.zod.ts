import type { z } from "zod";

import { UserId, UserSecretId } from "@vps-claude/shared";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

import { userSecret } from "./user-secret.db";

export const SelectUserSecretSchema = createSelectSchema(userSecret, {
  id: UserSecretId,
  userId: UserId,
});
export type SelectUserSecretSchema = z.infer<typeof SelectUserSecretSchema>;

export const InsertUserSecretSchema = createInsertSchema(userSecret).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUserSecretSchema = z.infer<typeof InsertUserSecretSchema>;
