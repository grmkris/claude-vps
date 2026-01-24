import type { ApiKeyPermissions } from "@vps-claude/auth";

import { ORPCError } from "@orpc/server";
import { ApiKeyId } from "@vps-claude/shared";
import { z } from "zod";

import { protectedProcedure } from "../index";
import { ApiKeyCreateOutput, ApiKeyListOutput, SuccessOutput } from "./schemas";

// Flat string array to avoid type explosion (TS7056)
// Format: "resource:action" e.g. ["box:create", "secret:read"]
const createApiKeyInput = z.object({
  name: z.string().min(1).max(100),
  permissions: z.array(z.string()).optional(),
  expiresIn: z.number().positive().optional(),
});

// Parse flat permissions back to nested format for service
function parsePermissions(perms?: string[]): ApiKeyPermissions | undefined {
  if (!perms?.length) return undefined;
  const result: Record<string, string[]> = {};
  for (const p of perms) {
    const [resource, action] = p.split(":");
    if (resource && action) {
      (result[resource] ??= []).push(action);
    }
  }
  return result as ApiKeyPermissions;
}

export const apiKeyRouter = {
  create: protectedProcedure
    .route({ method: "POST", path: "/api-key" })
    .input(createApiKeyInput)
    .output(ApiKeyCreateOutput)
    .handler(async ({ context, input }) => {
      const result = await context.apiKeyService.create(
        context.session.user.id,
        {
          name: input.name,
          permissions: parsePermissions(input.permissions),
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
    .route({ method: "GET", path: "/api-key" })
    .input(
      z.object({
        limit: z.number().min(1).max(100).optional(),
        offset: z.number().min(0).optional(),
      })
    )
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
    .route({ method: "DELETE", path: "/api-key/:keyId" })
    .input(z.object({ keyId: ApiKeyId }))
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
