import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

import { account, session, user, verification } from "./auth.db";

export const UserSelectSchema = createSelectSchema(user);
export const UserInsertSchema = createInsertSchema(user, {
	name: z.string().min(1).max(255),
	email: z.string().email(),
});

export const SessionSelectSchema = createSelectSchema(session);
export const SessionInsertSchema = createInsertSchema(session);

export const AccountSelectSchema = createSelectSchema(account);
export const AccountInsertSchema = createInsertSchema(account);

export const VerificationSelectSchema = createSelectSchema(verification);
export const VerificationInsertSchema = createInsertSchema(verification);

export type UserSelect = z.infer<typeof UserSelectSchema>;
export type UserInsert = z.infer<typeof UserInsertSchema>;

export type SessionSelect = z.infer<typeof SessionSelectSchema>;
export type SessionInsert = z.infer<typeof SessionInsertSchema>;

export type AccountSelect = z.infer<typeof AccountSelectSchema>;
export type AccountInsert = z.infer<typeof AccountInsertSchema>;

export type VerificationSelect = z.infer<typeof VerificationSelectSchema>;
export type VerificationInsert = z.infer<typeof VerificationInsertSchema>;
