import {
  SelectBoxSchema,
  SelectSkillSchema,
  SelectUserSecretSchema,
} from "@vps-claude/db";
import { z } from "zod";

// === Shared ===
export const SuccessOutput = z.object({ success: z.literal(true) });
export const HealthCheckOutput = z.string();
export const PrivateDataOutput = z.object({
  message: z.string(),
  user: z
    .object({
      id: z.string(),
      email: z.string(),
      name: z.string().nullable(),
      image: z.string().nullable().optional(),
    })
    .optional(),
});

// === Box Router ===
export const BoxListOutput = z.object({ boxes: z.array(SelectBoxSchema) });
export const BoxByIdOutput = z.object({ box: SelectBoxSchema });
export const BoxCreateOutput = z.object({ box: SelectBoxSchema });
export const BoxUrlOutput = z.object({ url: z.string() });
export const BoxProxyOutput = z.object({
  proxyUrl: z.string(),
  token: z.string(),
  host: z.string(),
  port: z.number(),
});

// === Secret Router ===
export const SecretListOutput = z.object({
  secrets: z.array(SelectUserSecretSchema),
});

// === Skill Router ===
export const SkillListOutput = z.object({
  skills: z.array(SelectSkillSchema),
});
export const SkillByIdOutput = z.object({ skill: SelectSkillSchema });
export const SkillCreateOutput = z.object({ skill: SelectSkillSchema });
export const SkillUpdateOutput = z.object({ skill: SelectSkillSchema });

// === API Key Router ===
export const ApiKeyCreateOutput = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  createdAt: z.date(),
});
export const ApiKeyListOutput = z.object({
  apiKeys: z.array(
    z.object({
      id: z.string(),
      name: z.string().nullable(),
      start: z.string().nullable(),
      createdAt: z.date(),
      lastRequest: z.date().nullable(),
      expiresAt: z.date().nullable(),
    })
  ),
});
