import type { ApiKeyPermissions } from "@vps-claude/auth";

import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { protectedProcedure } from "../index";
import { ApiKeyCreateOutput, ApiKeyListOutput, SuccessOutput } from "./schemas";

const createApiKeyInput = z.object({
  name: z.string().min(1).max(100),
  permissions: z
    .object({
      box: z.array(z.enum(["create", "read", "delete", "deploy"])).optional(),
      secret: z.array(z.enum(["read", "create", "delete"])).optional(),
      skill: z.array(z.enum(["read", "create", "delete"])).optional(),
    })
    .optional(),
  expiresIn: z.number().positive().optional(),
});

export const apiKeyRouter = {
  create: protectedProcedure
    .input(createApiKeyInput)
    .output(ApiKeyCreateOutput)
    .handler(async ({ context, input }) => {
      const result = await context.apiKeyService.create(
        context.session.user.id,
        {
          name: input.name,
          permissions: input.permissions as ApiKeyPermissions,
          expiresIn: input.expiresIn,
        }
      );

      return result.match(
        (apiKey) => ({
          id: apiKey.id,
          key: apiKey.key,
          name: apiKey.name,
          createdAt: apiKey.createdAt,
        }),
        (error) => {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: error.message,
          });
        }
      );
    }),

  list: protectedProcedure
    .output(ApiKeyListOutput)
    .handler(async ({ context }) => {
      const result = await context.apiKeyService.list(context.session.user.id);

      return result.match(
        (apiKeys) => ({
          apiKeys: apiKeys.map((key) => ({
            id: key.id,
            name: key.name ?? null,
            start: key.start ?? null,
            createdAt: key.createdAt,
            lastRequest: key.lastRequest ?? null,
            expiresAt: key.expiresAt ?? null,
          })),
        }),
        (error) => {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: error.message,
          });
        }
      );
    }),

  delete: protectedProcedure
    .input(z.object({ keyId: z.string().min(1) }))
    .output(SuccessOutput)
    .handler(async ({ context, input }) => {
      const result = await context.apiKeyService.delete(
        context.session.user.id,
        input.keyId
      );

      return result.match(
        () => ({ success: true as const }),
        (error) => {
          if (error.type === "NOT_FOUND") {
            throw new ORPCError("NOT_FOUND", { message: error.message });
          }
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: error.message,
          });
        }
      );
    }),
};
