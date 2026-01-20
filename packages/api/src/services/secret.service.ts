import type { Database, SelectUserSecretSchema } from "@vps-claude/db";
import type { UserId } from "@vps-claude/shared";

import { userSecret } from "@vps-claude/db";
import { and, eq } from "drizzle-orm";
import { type Result, err, ok } from "neverthrow";

export type SecretServiceError =
  | { type: "NOT_FOUND"; message: string }
  | { type: "ALREADY_EXISTS"; message: string };

interface SecretServiceDeps {
  db: Database;
}

export function createSecretService({ deps }: { deps: SecretServiceDeps }) {
  const { db } = deps;

  return {
    async list(
      userId: UserId
    ): Promise<Result<SelectUserSecretSchema[], SecretServiceError>> {
      const secrets = await db.query.userSecret.findMany({
        where: eq(userSecret.userId, userId),
        orderBy: userSecret.key,
      });
      return ok(secrets);
    },

    async set(
      userId: UserId,
      key: string,
      value: string
    ): Promise<Result<void, SecretServiceError>> {
      const existing = await db
        .select()
        .from(userSecret)
        .where(and(eq(userSecret.userId, userId), eq(userSecret.key, key)))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(userSecret)
          .set({ value })
          .where(and(eq(userSecret.userId, userId), eq(userSecret.key, key)));
      } else {
        await db.insert(userSecret).values({ userId, key, value });
      }

      return ok(undefined);
    },

    async delete(
      userId: UserId,
      key: string
    ): Promise<Result<void, SecretServiceError>> {
      const result = await db
        .delete(userSecret)
        .where(and(eq(userSecret.userId, userId), eq(userSecret.key, key)))
        .returning();

      if (result.length === 0) {
        return err({ type: "NOT_FOUND", message: "Secret not found" });
      }

      return ok(undefined);
    },

    async getAll(
      userId: UserId
    ): Promise<Result<Record<string, string>, SecretServiceError>> {
      const secrets = await db
        .select({ key: userSecret.key, value: userSecret.value })
        .from(userSecret)
        .where(eq(userSecret.userId, userId));

      const result: Record<string, string> = {};
      for (const s of secrets) {
        result[s.key] = s.value;
      }
      return ok(result);
    },
  };
}

export type SecretService = ReturnType<typeof createSecretService>;
