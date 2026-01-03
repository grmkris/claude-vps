import type { Database } from "@vps-claude/db";

import { box, type Box } from "@vps-claude/db";
import { getDeployQueue, getDeleteQueue } from "@vps-claude/queue";
import { BoxId } from "@vps-claude/shared";
import { generateSubdomain } from "@vps-claude/shared";
import { and, eq, ne } from "drizzle-orm";
import { Result, ok, err } from "neverthrow";

export type BoxServiceError =
  | { type: "NOT_FOUND"; message: string }
  | { type: "ALREADY_EXISTS"; message: string }
  | { type: "INVALID_STATUS"; message: string }
  | { type: "VALIDATION_FAILED"; message: string };

interface BoxServiceDeps {
  db: Database;
}

export function createBoxService({ deps }: { deps: BoxServiceDeps }) {
  const { db } = deps;

  return {
    async getById(id: BoxId): Promise<Box | undefined> {
      const result = await db.select().from(box).where(eq(box.id, id)).limit(1);
      return result[0];
    },

    async listByUser(userId: string): Promise<Box[]> {
      return db
        .select()
        .from(box)
        .where(and(eq(box.userId, userId), ne(box.status, "deleted")))
        .orderBy(box.createdAt);
    },

    async create(
      userId: string,
      input: { name: string; password: string }
    ): Promise<Result<Box, BoxServiceError>> {
      const existingByName = await db
        .select()
        .from(box)
        .where(and(eq(box.name, input.name), ne(box.status, "deleted")))
        .limit(1);

      if (existingByName.length > 0) {
        return err({
          type: "ALREADY_EXISTS",
          message: "Box with this name already exists",
        });
      }

      const subdomain = generateSubdomain(input.name);

      const result = await db
        .insert(box)
        .values({
          name: input.name,
          subdomain,
          status: "pending",
          userId,
        })
        .returning();

      const created = result[0];
      if (!created) {
        return err({
          type: "VALIDATION_FAILED",
          message: "Failed to create box",
        });
      }

      return ok(created);
    },

    async deploy(
      id: string,
      userId: string,
      password: string
    ): Promise<Result<{ success: true }, BoxServiceError>> {
      const boxRecord = await this.getById(id);

      if (!boxRecord) {
        return err({ type: "NOT_FOUND", message: "Box not found" });
      }

      if (boxRecord.userId !== userId) {
        return err({ type: "NOT_FOUND", message: "Box not found" });
      }

      if (boxRecord.status !== "pending" && boxRecord.status !== "error") {
        return err({
          type: "INVALID_STATUS",
          message: "Box cannot be deployed in current status",
        });
      }

      await db.update(box).set({ status: "deploying" }).where(eq(box.id, id));

      const deployQueue = getDeployQueue();
      await deployQueue.add("deploy", {
        boxId: id,
        subdomain: boxRecord.subdomain,
        password,
      });

      return ok({ success: true });
    },

    async delete(
      id: string,
      userId: string
    ): Promise<Result<{ success: true }, BoxServiceError>> {
      const boxRecord = await this.getById(id);

      if (!boxRecord) {
        return err({ type: "NOT_FOUND", message: "Box not found" });
      }

      if (boxRecord.userId !== userId) {
        return err({ type: "NOT_FOUND", message: "Box not found" });
      }

      if (boxRecord.coolifyApplicationUuid) {
        const deleteQueue = getDeleteQueue();
        await deleteQueue.add("delete", {
          boxId: id,
          coolifyApplicationUuid: boxRecord.coolifyApplicationUuid,
        });
      }

      await db.update(box).set({ status: "deleted" }).where(eq(box.id, id));

      return ok({ success: true });
    },

    async updateStatus(
      id: string,
      status: Box["status"],
      errorMessage?: string
    ): Promise<void> {
      await db
        .update(box)
        .set({
          status,
          errorMessage: errorMessage ?? null,
        })
        .where(eq(box.id, id));
    },

    async setCoolifyUuid(id: string, uuid: string): Promise<void> {
      await db
        .update(box)
        .set({ coolifyApplicationUuid: uuid })
        .where(eq(box.id, id));
    },
  };
}

export type BoxService = ReturnType<typeof createBoxService>;
