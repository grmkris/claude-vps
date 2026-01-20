import type { Auth, ApiKeyPermissions } from "@vps-claude/auth";

import { type Result, ok, err } from "neverthrow";

export type ApiKeyServiceError =
  | { type: "NOT_FOUND"; message: string }
  | { type: "INTERNAL_ERROR"; message: string };

interface ApiKeyServiceDeps {
  auth: Auth;
}

export interface ApiKeyRecord {
  id: string;
  key?: string;
  name: string;
  start?: string;
  createdAt: Date;
  lastRequest?: Date | null;
  expiresAt?: Date | null;
}

export function createApiKeyService({ deps }: { deps: ApiKeyServiceDeps }) {
  const { auth } = deps;

  return {
    async create(
      userId: string,
      input: {
        name: string;
        permissions?: ApiKeyPermissions;
        expiresIn?: number;
      }
    ): Promise<Result<ApiKeyRecord & { key: string }, ApiKeyServiceError>> {
      const result = await auth.api.createApiKey({
        body: {
          name: input.name,
          userId,
          permissions: input.permissions,
          expiresIn: input.expiresIn,
        },
      });

      if (!result?.key) {
        return err({
          type: "INTERNAL_ERROR",
          message: "Failed to create API key",
        });
      }

      return ok({
        id: result.id,
        key: result.key,
        name: result.name ?? "Unnamed",
        createdAt: result.createdAt,
      });
    },

    async list(
      userId: string
    ): Promise<Result<ApiKeyRecord[], ApiKeyServiceError>> {
      const result = await auth.api.listApiKeys({
        query: { userId },
      });

      return ok(
        (result || []).map((key) => ({
          id: key.id,
          name: key.name ?? "Unnamed",
          start: key.start ?? undefined,
          createdAt: key.createdAt,
          lastRequest: key.lastRequest ?? undefined,
          expiresAt: key.expiresAt ?? undefined,
        }))
      );
    },

    async delete(
      userId: string,
      keyId: string
    ): Promise<Result<void, ApiKeyServiceError>> {
      const keys = await auth.api.listApiKeys({
        query: { userId },
      });

      const keyBelongsToUser = keys?.some((k) => k.id === keyId);
      if (!keyBelongsToUser) {
        return err({ type: "NOT_FOUND", message: "API key not found" });
      }

      await auth.api.deleteApiKey({
        body: { keyId },
      });

      return ok(undefined);
    },
  };
}

export type ApiKeyService = ReturnType<typeof createApiKeyService>;
