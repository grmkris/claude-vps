import type { Database, SelectBoxSchema } from "@vps-claude/db";
import type { QueueClient } from "@vps-claude/queue";
import type { SpritesClient } from "@vps-claude/sprites";

import { box, boxSkill } from "@vps-claude/db";
import { type BoxId, type SkillId, type UserId } from "@vps-claude/shared";
import { generateSubdomain } from "@vps-claude/shared";
import { eq } from "drizzle-orm";
import { type Result, err, ok } from "neverthrow";

export type BoxServiceError =
  | { type: "NOT_FOUND"; message: string }
  | { type: "ALREADY_EXISTS"; message: string }
  | { type: "INVALID_STATUS"; message: string }
  | { type: "VALIDATION_FAILED"; message: string };

interface BoxServiceDeps {
  db: Database;
  queueClient: QueueClient;
  spritesClient?: SpritesClient;
}

export function createBoxService({ deps }: { deps: BoxServiceDeps }) {
  const { db, queueClient, spritesClient } = deps;

  const getById = async (
    id: BoxId
  ): Promise<Result<SelectBoxSchema | null, BoxServiceError>> => {
    const result = await db.query.box.findFirst({
      where: eq(box.id, id),
    });
    return ok(result ?? null);
  };
  return {
    getById,

    async listByUser(
      userId: UserId
    ): Promise<Result<SelectBoxSchema[], BoxServiceError>> {
      const boxes = await db.query.box.findMany({
        where: eq(box.userId, userId),
        orderBy: box.createdAt,
      });
      return ok(boxes);
    },

    async create(
      userId: UserId,
      input: {
        name: string;
        password: string;
        skills?: SkillId[];
        telegramBotToken?: string;
        telegramChatId?: string;
      }
    ): Promise<Result<SelectBoxSchema, BoxServiceError>> {
      const existingByName = await db.query.box.findFirst({
        where: eq(box.name, input.name),
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
          telegramBotToken: input.telegramBotToken,
          telegramChatId: input.telegramChatId,
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
    ): Promise<Result<void, BoxServiceError>> {
      const boxResult = await getById(id);
      if (boxResult.isErr()) return err(boxResult.error);
      const boxRecord = boxResult.value;

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

      return ok(undefined);
    },

    async delete(
      id: BoxId,
      userId: UserId
    ): Promise<Result<void, BoxServiceError>> {
      const boxResult = await getById(id);
      if (boxResult.isErr()) return err(boxResult.error);
      const boxRecord = boxResult.value;

      if (!boxRecord) {
        return err({ type: "NOT_FOUND", message: "Box not found" });
      }

      if (boxRecord.userId !== userId) {
        return err({ type: "NOT_FOUND", message: "Box not found" });
      }

      await db.delete(box).where(eq(box.id, id));

      if (boxRecord.spriteName) {
        await queueClient.deleteQueue.add("delete", {
          boxId: id,
          userId: boxRecord.userId,
        });
      }

      return ok(undefined);
    },

    async updateTelegramConfig(
      boxId: BoxId,
      config: { telegramBotToken?: string; telegramChatId?: string }
    ): Promise<Result<void, BoxServiceError>> {
      const existingResult = await getById(boxId);
      if (existingResult.isErr()) return err(existingResult.error);
      const existing = existingResult.value;

      if (!existing) {
        return err({ type: "NOT_FOUND", message: "Box not found" });
      }

      await db
        .update(box)
        .set({
          telegramBotToken: config.telegramBotToken,
          telegramChatId: config.telegramChatId,
        })
        .where(eq(box.id, boxId));

      // Hot update env vars on running sprite (no full redeploy needed)
      if (
        spritesClient &&
        existing.spriteName &&
        existing.status === "running"
      ) {
        const envUpdates: Record<string, string> = {};
        if (config.telegramBotToken) {
          envUpdates.TAKOPI_BOT_TOKEN = config.telegramBotToken;
        }
        if (config.telegramChatId) {
          envUpdates.TAKOPI_CHAT_ID = config.telegramChatId;
        }
        if (Object.keys(envUpdates).length > 0) {
          await spritesClient.updateEnvVars(existing.spriteName, envUpdates);
        }
      }

      return ok(undefined);
    },

    async updateStatus(
      id: BoxId,
      status: SelectBoxSchema["status"],
      errorMessage?: string
    ): Promise<Result<void, BoxServiceError>> {
      await db
        .update(box)
        .set({
          status,
          errorMessage: errorMessage ?? null,
        })
        .where(eq(box.id, id));
      return ok(undefined);
    },

    async setSpriteInfo(
      id: BoxId,
      spriteName: string,
      spriteUrl: string,
      passwordHash: string
    ): Promise<Result<void, BoxServiceError>> {
      await db
        .update(box)
        .set({ spriteName, spriteUrl, passwordHash })
        .where(eq(box.id, id));
      return ok(undefined);
    },
  };
}

export type BoxService = ReturnType<typeof createBoxService>;
