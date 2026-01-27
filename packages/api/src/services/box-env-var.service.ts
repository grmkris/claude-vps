import type { Database, SelectBoxEnvVarSchema } from "@vps-claude/db";
import type { BoxId, UserId } from "@vps-claude/shared";

import { box, boxEnvVar, userSecret } from "@vps-claude/db";
import { and, eq } from "drizzle-orm";
import { type Result, err, ok } from "neverthrow";

export type BoxEnvVarServiceError =
  | { type: "NOT_FOUND"; message: string }
  | { type: "BOX_NOT_FOUND"; message: string }
  | { type: "NOT_AUTHORIZED"; message: string }
  | { type: "INVALID_CREDENTIAL"; message: string };

interface BoxEnvVarServiceDeps {
  db: Database;
}

export function createBoxEnvVarService({
  deps,
}: {
  deps: BoxEnvVarServiceDeps;
}) {
  const { db } = deps;

  async function verifyBoxOwnership(
    boxId: BoxId,
    userId: UserId
  ): Promise<Result<true, BoxEnvVarServiceError>> {
    const boxRecord = await db.query.box.findFirst({
      where: eq(box.id, boxId),
    });

    if (!boxRecord) {
      return err({ type: "BOX_NOT_FOUND", message: "Box not found" });
    }

    if (boxRecord.userId !== userId) {
      return err({ type: "NOT_AUTHORIZED", message: "Not authorized" });
    }

    return ok(true);
  }

  return {
    async list(
      boxId: BoxId,
      userId: UserId
    ): Promise<Result<SelectBoxEnvVarSchema[], BoxEnvVarServiceError>> {
      const ownershipCheck = await verifyBoxOwnership(boxId, userId);
      if (ownershipCheck.isErr()) {
        return err(ownershipCheck.error);
      }

      const envVars = await db.query.boxEnvVar.findMany({
        where: eq(boxEnvVar.boxId, boxId),
        orderBy: boxEnvVar.key,
      });
      return ok(envVars);
    },

    async set(
      boxId: BoxId,
      userId: UserId,
      input: {
        key: string;
        type: "literal" | "credential_ref";
        value?: string;
        credentialKey?: string;
      }
    ): Promise<Result<void, BoxEnvVarServiceError>> {
      const ownershipCheck = await verifyBoxOwnership(boxId, userId);
      if (ownershipCheck.isErr()) {
        return err(ownershipCheck.error);
      }

      // If credential_ref, verify the credential exists
      if (input.type === "credential_ref" && input.credentialKey) {
        const credential = await db.query.userSecret.findFirst({
          where: and(
            eq(userSecret.userId, userId),
            eq(userSecret.key, input.credentialKey)
          ),
        });
        if (!credential) {
          return err({
            type: "INVALID_CREDENTIAL",
            message: `Credential "${input.credentialKey}" not found`,
          });
        }
      }

      const existing = await db
        .select()
        .from(boxEnvVar)
        .where(and(eq(boxEnvVar.boxId, boxId), eq(boxEnvVar.key, input.key)))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(boxEnvVar)
          .set({
            type: input.type,
            value: input.type === "literal" ? input.value : null,
            credentialKey:
              input.type === "credential_ref" ? input.credentialKey : null,
          })
          .where(and(eq(boxEnvVar.boxId, boxId), eq(boxEnvVar.key, input.key)));
      } else {
        await db.insert(boxEnvVar).values({
          boxId,
          key: input.key,
          type: input.type,
          value: input.type === "literal" ? input.value : null,
          credentialKey:
            input.type === "credential_ref" ? input.credentialKey : null,
        });
      }

      return ok(undefined);
    },

    async delete(
      boxId: BoxId,
      userId: UserId,
      key: string
    ): Promise<Result<void, BoxEnvVarServiceError>> {
      const ownershipCheck = await verifyBoxOwnership(boxId, userId);
      if (ownershipCheck.isErr()) {
        return err(ownershipCheck.error);
      }

      const result = await db
        .delete(boxEnvVar)
        .where(and(eq(boxEnvVar.boxId, boxId), eq(boxEnvVar.key, key)))
        .returning();

      if (result.length === 0) {
        return err({
          type: "NOT_FOUND",
          message: "Environment variable not found",
        });
      }

      return ok(undefined);
    },

    /**
     * Resolve all env vars for a box, expanding credential references.
     * Used during deployment to get actual values.
     */
    async resolveAll(
      boxId: BoxId,
      userId: UserId
    ): Promise<Result<Record<string, string>, BoxEnvVarServiceError>> {
      const envVars = await db.query.boxEnvVar.findMany({
        where: eq(boxEnvVar.boxId, boxId),
      });

      // Get all user credentials for resolving refs
      const credentials = await db.query.userSecret.findMany({
        where: eq(userSecret.userId, userId),
      });
      const credentialMap = new Map(credentials.map((c) => [c.key, c.value]));

      const result: Record<string, string> = {};

      for (const envVar of envVars) {
        if (envVar.type === "literal" && envVar.value) {
          result[envVar.key] = envVar.value;
        } else if (envVar.type === "credential_ref" && envVar.credentialKey) {
          const credentialValue = credentialMap.get(envVar.credentialKey);
          if (credentialValue) {
            result[envVar.key] = credentialValue;
          }
          // Skip if credential not found (deleted after env var was created)
        }
      }

      return ok(result);
    },

    /**
     * Bulk set env vars (used during box creation)
     */
    async bulkSet(
      boxId: BoxId,
      userId: UserId,
      envVars: Array<{
        key: string;
        type: "literal" | "credential_ref";
        value?: string;
        credentialKey?: string;
      }>
    ): Promise<Result<void, BoxEnvVarServiceError>> {
      for (const envVar of envVars) {
        const result = await this.set(boxId, userId, envVar);
        if (result.isErr()) {
          return err(result.error);
        }
      }
      return ok(undefined);
    },
  };
}

export type BoxEnvVarService = ReturnType<typeof createBoxEnvVarService>;
