import type {
  BoxAgentConfigResponseSchema,
  Database,
  InsertBoxAgentConfigSchema,
  SelectBoxAgentConfigSchema,
  SelectBoxSchema,
  TriggerType,
  UpdateBoxAgentConfigSchema,
} from "@vps-claude/db";
import type { QueueClient } from "@vps-claude/queue";
import type { SpritesClient } from "@vps-claude/sprites";

import { box, boxAgentConfig, boxSkill } from "@vps-claude/db";
import {
  type BoxAgentConfigId,
  type BoxId,
  type UserId,
} from "@vps-claude/shared";
import { generateSubdomain } from "@vps-claude/shared";
import { and, eq } from "drizzle-orm";
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
        /** Skills.sh skill IDs (e.g. "vercel-react-best-practices") */
        skills?: string[];
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

      // Create default agent config
      await db.insert(boxAgentConfig).values({
        boxId: created.id,
        triggerType: "default",
        name: "Default",
      });

      await queueClient.deployQueue.add("deploy", {
        boxId: created.id,
        userId,
        subdomain: created.subdomain,
        skills,
      });

      return ok(created);
    },

    async deploy(
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
      spriteUrl: string
    ): Promise<Result<void, BoxServiceError>> {
      await db
        .update(box)
        .set({ spriteName, spriteUrl })
        .where(eq(box.id, id));
      return ok(undefined);
    },

    async getAgentConfig(
      boxId: BoxId,
      triggerType: TriggerType
    ): Promise<Result<BoxAgentConfigResponseSchema, BoxServiceError>> {
      // Try specific trigger config first
      let config = await db.query.boxAgentConfig.findFirst({
        where: and(
          eq(boxAgentConfig.boxId, boxId),
          eq(boxAgentConfig.triggerType, triggerType)
        ),
      });

      // Fallback to default config if no specific trigger config
      if (!config && triggerType !== "default") {
        config = await db.query.boxAgentConfig.findFirst({
          where: and(
            eq(boxAgentConfig.boxId, boxId),
            eq(boxAgentConfig.triggerType, "default")
          ),
        });
      }

      // Return default config if nothing in database
      const DEFAULT_APPEND_PROMPT = `You are an AI assistant running inside a VPS box.
You can read/write files, run commands, and interact with the system.
When handling emails, read the content and respond appropriately.`;

      return ok({
        model: config?.model ?? "claude-sonnet-4-5-20250929",
        systemPrompt: config?.systemPrompt ?? null,
        appendSystemPrompt: config?.appendSystemPrompt ?? DEFAULT_APPEND_PROMPT,
        tools: config?.tools ?? null,
        allowedTools: config?.allowedTools ?? null,
        disallowedTools: config?.disallowedTools ?? null,
        permissionMode: config?.permissionMode ?? "bypassPermissions",
        maxTurns: config?.maxTurns ?? 50,
        maxBudgetUsd: config?.maxBudgetUsd ?? "1.00",
        persistSession: config?.persistSession ?? true,
        mcpServers: config?.mcpServers ?? null,
        agents: config?.agents ?? null,
      });
    },

    async listAgentConfigs(
      boxId: BoxId
    ): Promise<Result<SelectBoxAgentConfigSchema[], BoxServiceError>> {
      const configs = await db.query.boxAgentConfig.findMany({
        where: eq(boxAgentConfig.boxId, boxId),
      });
      return ok(configs);
    },

    async getAgentConfigById(
      configId: BoxAgentConfigId
    ): Promise<Result<SelectBoxAgentConfigSchema | null, BoxServiceError>> {
      const config = await db.query.boxAgentConfig.findFirst({
        where: eq(boxAgentConfig.id, configId),
      });
      return ok(config ?? null);
    },

    async createAgentConfig(
      input: InsertBoxAgentConfigSchema
    ): Promise<Result<SelectBoxAgentConfigSchema, BoxServiceError>> {
      const result = await db.insert(boxAgentConfig).values(input).returning();

      const created = result[0];
      if (!created) {
        return err({
          type: "VALIDATION_FAILED",
          message: "Failed to create agent config",
        });
      }

      return ok(created);
    },

    async updateAgentConfig(
      configId: BoxAgentConfigId,
      input: UpdateBoxAgentConfigSchema
    ): Promise<Result<SelectBoxAgentConfigSchema, BoxServiceError>> {
      const result = await db
        .update(boxAgentConfig)
        .set(input)
        .where(eq(boxAgentConfig.id, configId))
        .returning();

      const updated = result[0];
      if (!updated) {
        return err({
          type: "NOT_FOUND",
          message: "Agent config not found",
        });
      }

      return ok(updated);
    },

    async deleteAgentConfig(
      configId: BoxAgentConfigId
    ): Promise<Result<void, BoxServiceError>> {
      const config = await db.query.boxAgentConfig.findFirst({
        where: eq(boxAgentConfig.id, configId),
      });

      if (!config) {
        return err({
          type: "NOT_FOUND",
          message: "Agent config not found",
        });
      }

      // Prevent deleting default config
      if (config.triggerType === "default") {
        return err({
          type: "VALIDATION_FAILED",
          message: "Cannot delete default agent config",
        });
      }

      await db.delete(boxAgentConfig).where(eq(boxAgentConfig.id, configId));
      return ok(undefined);
    },
  };
}

export type BoxService = ReturnType<typeof createBoxService>;
