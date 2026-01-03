import { typeid } from "typeid-js";
import { z } from "zod";

export const idTypesMapNameToPrefix = {
  user: "usr",
  session: "ses",
  account: "acc",
  verification: "ver",
  box: "box",
} as const;

export type IdTypeName = keyof typeof idTypesMapNameToPrefix;
export type IdTypePrefix = (typeof idTypesMapNameToPrefix)[IdTypeName];

export function typeIdGenerator<T extends IdTypeName>(name: T): string {
  const prefix = idTypesMapNameToPrefix[name];
  return typeid(prefix).toString();
}

export function typeIdValidator<T extends IdTypeName>(name: T) {
  const prefix = idTypesMapNameToPrefix[name];
  return z
    .string()
    .refine((val) => val.startsWith(`${prefix}_`), { message: `Invalid ${name} ID format` });
}

export const UserId = typeIdValidator("user");
export type UserId = z.infer<typeof UserId>;

export const SessionId = typeIdValidator("session");
export type SessionId = z.infer<typeof SessionId>;

export const AccountId = typeIdValidator("account");
export type AccountId = z.infer<typeof AccountId>;

export const VerificationId = typeIdValidator("verification");
export type VerificationId = z.infer<typeof VerificationId>;

export const BoxId = typeIdValidator("box");
export type BoxId = z.infer<typeof BoxId>;
