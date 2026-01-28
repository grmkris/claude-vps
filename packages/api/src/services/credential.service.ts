import type { Database, SelectUserCredentialSchema } from "@vps-claude/db";
import type { UserId } from "@vps-claude/shared";

import { boxEnvVar, userCredential } from "@vps-claude/db";
import { and, eq } from "drizzle-orm";
import { type Result, err, ok } from "neverthrow";

export type CredentialServiceError =
  | { type: "NOT_FOUND"; message: string }
  | { type: "ALREADY_EXISTS"; message: string }
  | { type: "IN_USE"; message: string };

interface CredentialServiceDeps {
  db: Database;
}

export function createCredentialService({
  deps,
}: {
  deps: CredentialServiceDeps;
}) {
  const { db } = deps;

  return {
    async list(
      userId: UserId
    ): Promise<Result<SelectUserCredentialSchema[], CredentialServiceError>> {
      const credentials = await db.query.userCredential.findMany({
        where: eq(userCredential.userId, userId),
        orderBy: userCredential.key,
      });
      return ok(credentials);
    },

    async set(
      userId: UserId,
      key: string,
      value: string
    ): Promise<Result<void, CredentialServiceError>> {
      const existing = await db
        .select()
        .from(userCredential)
        .where(
          and(eq(userCredential.userId, userId), eq(userCredential.key, key))
        )
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(userCredential)
          .set({ value })
          .where(
            and(eq(userCredential.userId, userId), eq(userCredential.key, key))
          );
      } else {
        await db.insert(userCredential).values({ userId, key, value });
      }

      return ok(undefined);
    },

    async delete(
      userId: UserId,
      key: string
    ): Promise<Result<void, CredentialServiceError>> {
      // Check if credential is referenced by any box env vars
      const refs = await db
        .select({ boxId: boxEnvVar.boxId })
        .from(boxEnvVar)
        .where(
          and(
            eq(boxEnvVar.type, "credential_ref"),
            eq(boxEnvVar.credentialKey, key)
          )
        );

      if (refs.length > 0) {
        return err({
          type: "IN_USE",
          message: `Credential is used by ${refs.length} box(es). Remove the references first.`,
        });
      }

      const result = await db
        .delete(userCredential)
        .where(
          and(eq(userCredential.userId, userId), eq(userCredential.key, key))
        )
        .returning();

      if (result.length === 0) {
        return err({ type: "NOT_FOUND", message: "Credential not found" });
      }

      return ok(undefined);
    },

    async getAll(
      userId: UserId
    ): Promise<Result<Record<string, string>, CredentialServiceError>> {
      const credentials = await db
        .select({ key: userCredential.key, value: userCredential.value })
        .from(userCredential)
        .where(eq(userCredential.userId, userId));

      const result: Record<string, string> = {};
      for (const c of credentials) {
        result[c.key] = c.value;
      }
      return ok(result);
    },
  };
}

export type CredentialService = ReturnType<typeof createCredentialService>;
