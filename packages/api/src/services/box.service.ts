import type { Database } from "@vps-claude/db";
import type { QueueClient } from "@vps-claude/queue";

import { box, boxSkill, type Box } from "@vps-claude/db";
import { type UserId, BoxId, type SkillId } from "@vps-claude/shared";
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
  queueClient: QueueClient;
}

export function createBoxService({ deps }: { deps: BoxServiceDeps }) {
  const { db, queueClient } = deps;

  const getById = async (id: BoxId): Promise<Box | undefined> => {
    const result = await db.query.box.findFirst({
      where: eq(box.id, id),
    });
    return result;
  };
  return {
    getById,

    async listByUser(userId: UserId): Promise<Box[]> {
      return db.query.box.findMany({
        where: and(eq(box.userId, userId), ne(box.status, "deleted")),
        orderBy: box.createdAt,
      });
    },

    async create(
      userId: UserId,
      input: { name: string; password: string; skills?: SkillId[] }
    ): Promise<Result<Box, BoxServiceError>> {
      const existingByName = await db.query.box.findFirst({
        where: and(eq(box.name, input.name), ne(box.status, "deleted")),
      });

      if (existingByName) {
        return err({
          type: "ALREADY_EXISTS",
          message: "Box with this name already exists",
        });
      }

      const subdomain = generateSubdomain(input.name);
      const skills = input.skills ?? [];

      const result = await db
        .insert(box)
        .values({
          name: input.name,
          subdomain,
          status: "deploying",
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

      if (skills.length > 0) {
        await db
          .insert(boxSkill)
          .values(skills.map((skillId) => ({ boxId: created.id, skillId })));
      }

      await queueClient.deployQueue.add("deploy", {
        boxId: created.id,
        userId,
        subdomain: created.subdomain,
        password: input.password,
        skills,
      });

      return ok(created);
    },

    async deploy(
      id: BoxId,
      userId: UserId,
      password: string
    ): Promise<Result<{ success: true }, BoxServiceError>> {
      const boxRecord = await getById(id);

      if (!boxRecord) {
        return err({ type: "NOT_FOUND", message: "Box not found" });
      }

      if (boxRecord.userId !== userId) {
        return err({ type: "NOT_FOUND", message: "Box not found" });
      }

      if (boxRecord.status !== "error") {
        return err({
          type: "INVALID_STATUS",
          message: "Only boxes with error status can be redeployed",
        });
      }

      const skills = await db
        .select({ skillId: boxSkill.skillId })
        .from(boxSkill)
        .where(eq(boxSkill.boxId, id));

      await db.update(box).set({ status: "deploying" }).where(eq(box.id, id));

      await queueClient.deployQueue.add("deploy", {
        boxId: id,
        userId,
        subdomain: boxRecord.subdomain,
        password,
        skills: skills.map((s) => s.skillId),
      });

      return ok({ success: true });
    },

    async delete(
      id: BoxId,
      userId: UserId
    ): Promise<Result<{ success: true }, BoxServiceError>> {
      const boxRecord = await getById(id);

      if (!boxRecord) {
        return err({ type: "NOT_FOUND", message: "Box not found" });
      }

      if (boxRecord.userId !== userId) {
        return err({ type: "NOT_FOUND", message: "Box not found" });
      }

      if (boxRecord.coolifyApplicationUuid) {
        await queueClient.deleteQueue.add("delete", {
          boxId: id,
          coolifyApplicationUuid: boxRecord.coolifyApplicationUuid,
        });
      }

      await db.update(box).set({ status: "deleted" }).where(eq(box.id, id));

      return ok({ success: true });
    },

    async updateStatus(
      id: BoxId,
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

    async setCoolifyUuid(id: BoxId, uuid: string): Promise<void> {
      await db
        .update(box)
        .set({ coolifyApplicationUuid: uuid })
        .where(eq(box.id, id));
    },

    async setContainerInfo(
      id: BoxId,
      containerName: string,
      passwordHash: string
    ): Promise<void> {
      await db
        .update(box)
        .set({ containerName, passwordHash })
        .where(eq(box.id, id));
    },

    async getBySubdomain(subdomain: string): Promise<Box | undefined> {
      const result = await db.query.box.findFirst({
        where: eq(box.subdomain, subdomain),
      });
      return result;
    },

    async listRunningBoxes(): Promise<
      Array<{ subdomain: string; containerName: string; passwordHash: string }>
    > {
      const result = await db.query.box.findMany({
        where: eq(box.status, "running"),
      });

      return result
        .filter((b) => b.containerName !== null && b.passwordHash !== null)
        .map((b) => ({
          subdomain: b.subdomain,
          containerName: b.containerName!,
          passwordHash: b.passwordHash!,
        }));
    },
  };
}

export type BoxService = ReturnType<typeof createBoxService>;
