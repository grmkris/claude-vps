import type { Database } from "@vps-claude/db";
import { environment, type Environment } from "@vps-claude/db";
import { and, eq, ne } from "drizzle-orm";
import { Result, ok, err } from "neverthrow";

import { generateSubdomain } from "@vps-claude/shared";
import { getDeployQueue, getDeleteQueue } from "@vps-claude/queue";

export type EnvironmentServiceError =
  | { type: "NOT_FOUND"; message: string }
  | { type: "ALREADY_EXISTS"; message: string }
  | { type: "INVALID_STATUS"; message: string }
  | { type: "VALIDATION_FAILED"; message: string };

interface EnvironmentServiceDeps {
  db: Database;
}

export function createEnvironmentService({ deps }: { deps: EnvironmentServiceDeps }) {
  const { db } = deps;

  return {
    async getById(id: string): Promise<Environment | undefined> {
      const result = await db.select().from(environment).where(eq(environment.id, id)).limit(1);
      return result[0];
    },

    async listByUser(userId: string): Promise<Environment[]> {
      return db
        .select()
        .from(environment)
        .where(and(eq(environment.userId, userId), ne(environment.status, "deleted")))
        .orderBy(environment.createdAt);
    },

    async create(
      userId: string,
      input: { name: string; password: string },
    ): Promise<Result<Environment, EnvironmentServiceError>> {
      const existingByName = await db
        .select()
        .from(environment)
        .where(and(eq(environment.name, input.name), ne(environment.status, "deleted")))
        .limit(1);

      if (existingByName.length > 0) {
        return err({
          type: "ALREADY_EXISTS",
          message: "Environment with this name already exists",
        });
      }

      const subdomain = generateSubdomain(input.name);

      const result = await db
        .insert(environment)
        .values({
          name: input.name,
          subdomain,
          status: "pending",
          userId,
        })
        .returning();

      const created = result[0];
      if (!created) {
        return err({ type: "VALIDATION_FAILED", message: "Failed to create environment" });
      }

      return ok(created);
    },

    async deploy(
      id: string,
      userId: string,
      password: string,
    ): Promise<Result<{ success: true }, EnvironmentServiceError>> {
      const env = await this.getById(id);

      if (!env) {
        return err({ type: "NOT_FOUND", message: "Environment not found" });
      }

      if (env.userId !== userId) {
        return err({ type: "NOT_FOUND", message: "Environment not found" });
      }

      if (env.status !== "pending" && env.status !== "error") {
        return err({
          type: "INVALID_STATUS",
          message: "Environment cannot be deployed in current status",
        });
      }

      await db.update(environment).set({ status: "deploying" }).where(eq(environment.id, id));

      const deployQueue = getDeployQueue();
      await deployQueue.add("deploy", {
        environmentId: id,
        subdomain: env.subdomain,
        password,
      });

      return ok({ success: true });
    },

    async delete(
      id: string,
      userId: string,
    ): Promise<Result<{ success: true }, EnvironmentServiceError>> {
      const env = await this.getById(id);

      if (!env) {
        return err({ type: "NOT_FOUND", message: "Environment not found" });
      }

      if (env.userId !== userId) {
        return err({ type: "NOT_FOUND", message: "Environment not found" });
      }

      if (env.coolifyApplicationUuid) {
        const deleteQueue = getDeleteQueue();
        await deleteQueue.add("delete", {
          environmentId: id,
          coolifyApplicationUuid: env.coolifyApplicationUuid,
        });
      }

      await db.update(environment).set({ status: "deleted" }).where(eq(environment.id, id));

      return ok({ success: true });
    },

    async updateStatus(
      id: string,
      status: Environment["status"],
      errorMessage?: string,
    ): Promise<void> {
      await db
        .update(environment)
        .set({
          status,
          errorMessage: errorMessage ?? null,
        })
        .where(eq(environment.id, id));
    },

    async setCoolifyUuid(id: string, uuid: string): Promise<void> {
      await db
        .update(environment)
        .set({ coolifyApplicationUuid: uuid })
        .where(eq(environment.id, id));
    },
  };
}

export type EnvironmentService = ReturnType<typeof createEnvironmentService>;
