import type { z } from "zod";

import {
  AccountId,
  SessionId,
  UserId,
  VerificationId,
} from "@vps-claude/shared";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

import { account, session, user, verification } from "./auth.db";

export const SelectUserSchema = createSelectSchema(user, { id: UserId });
export type SelectUserSchema = z.infer<typeof SelectUserSchema>;

export const InsertUserSchema = createInsertSchema(user).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUserSchema = z.infer<typeof InsertUserSchema>;

export const SelectSessionSchema = createSelectSchema(session, {
  id: SessionId,
  userId: UserId,
});
export type SelectSessionSchema = z.infer<typeof SelectSessionSchema>;

export const InsertSessionSchema = createInsertSchema(session).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSessionSchema = z.infer<typeof InsertSessionSchema>;

export const SelectAccountSchema = createSelectSchema(account, {
  id: AccountId,
  userId: UserId,
});
export type SelectAccountSchema = z.infer<typeof SelectAccountSchema>;

export const InsertAccountSchema = createInsertSchema(account).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAccountSchema = z.infer<typeof InsertAccountSchema>;

export const SelectVerificationSchema = createSelectSchema(verification, {
  id: VerificationId,
});
export type SelectVerificationSchema = z.infer<typeof SelectVerificationSchema>;

export const InsertVerificationSchema = createInsertSchema(verification).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertVerificationSchema = z.infer<typeof InsertVerificationSchema>;
