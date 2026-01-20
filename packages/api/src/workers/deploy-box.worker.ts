import type { Logger } from "@vps-claude/logger";
import type { Redis } from "@vps-claude/redis";
import type { SpritesClient } from "@vps-claude/sprites";

import {
  type DeployBoxJobData,
  type DeleteBoxJobData,
  Worker,
  type Job,
} from "@vps-claude/queue";
import { WORKER_CONFIG } from "@vps-claude/shared";
import { createHash } from "node:crypto";

import type { BoxService } from "../services/box.service";
import type { EmailService } from "../services/email.service";
import type { SecretService } from "../services/secret.service";
import type { SkillService } from "../services/skill.service";

function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

interface DeployWorkerDeps {
  boxService: BoxService;
  emailService: EmailService;
  secretService: SecretService;
  skillService: SkillService;
  spritesClient: SpritesClient;
  redis: Redis;
  logger: Logger;
  serverUrl: string;
  boxAgentBinaryUrl: string;
}

interface DeleteWorkerDeps {
  boxService: BoxService;
  spritesClient: SpritesClient;
  redis: Redis;
  logger: Logger;
}

export function createDeployWorker({ deps }: { deps: DeployWorkerDeps }) {
  const {
    boxService,
    emailService,
    secretService,
    spritesClient,
    redis,
    logger,
    serverUrl,
    boxAgentBinaryUrl,
  } = deps;

  const worker = new Worker<DeployBoxJobData>(
    WORKER_CONFIG.deployBox.name,
    async (job: Job<DeployBoxJobData>) => {
      const { boxId, userId, subdomain, password } = job.data;

      try {
        const boxResult = await boxService.getById(boxId);
        if (boxResult.isErr()) {
          throw new Error(boxResult.error.message);
        }
        const box = boxResult.value;
        if (!box) {
          throw new Error("Box not found");
        }

        const userSecretsResult = await secretService.getAll(userId);
        if (userSecretsResult.isErr()) {
          throw new Error(userSecretsResult.error.message);
        }
        const userSecrets = userSecretsResult.value;
        const emailSettingsResult =
          await emailService.getOrCreateSettings(boxId);
        if (emailSettingsResult.isErr()) {
          throw new Error(emailSettingsResult.error.message);
        }
        const emailSettings = emailSettingsResult.value;

        const envVars: Record<string, string> = {
          PASSWORD: password,
          ...userSecrets,
          BOX_AGENT_SECRET: emailSettings.agentSecret,
          BOX_API_TOKEN: emailSettings.agentSecret,
          BOX_API_URL: `${serverUrl}/box`,
          BOX_SUBDOMAIN: subdomain,
        };

        if (box.telegramBotToken) {
          envVars.TAKOPI_BOT_TOKEN = box.telegramBotToken;
        }
        if (box.telegramChatId) {
          envVars.TAKOPI_CHAT_ID = box.telegramChatId;
        }

        // Step 1: Create the sprite (blank VM)
        logger.info({ boxId, subdomain }, "Creating Sprite");
        const sprite = await spritesClient.createSprite({
          name: subdomain,
          userId,
          subdomain,
          envVars: {}, // Env vars set during setup
        });

        await boxService.setSpriteInfo(
          boxId,
          sprite.spriteName,
          sprite.url,
          hashPassword(password)
        );

        // Step 2: Set up the sprite with SSH, code-server, box-agent
        logger.info(
          { boxId, subdomain, spriteName: sprite.spriteName },
          "Setting up Sprite"
        );
        await spritesClient.setupSprite({
          spriteName: sprite.spriteName,
          password,
          boxAgentBinaryUrl,
          envVars,
        });

        await boxService.updateStatus(boxId, "running");
        logger.info(
          { boxId, subdomain, spriteName: sprite.spriteName },
          "Sprite deployed and configured successfully"
        );

        return { success: true };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        logger.error({ boxId, error: message }, "Deploy job failed");
        await boxService.updateStatus(boxId, "error", message);
        throw error;
      }
    },
    {
      connection: redis,
      concurrency: 5,
      lockDuration: WORKER_CONFIG.deployBox.timeout,
    }
  );

  worker.on("failed", (job, err) => {
    logger.error({
      msg: "Deploy job failed",
      jobId: job?.id,
      error: err.message,
    });
  });

  return worker;
}

export function createDeleteWorker({ deps }: { deps: DeleteWorkerDeps }) {
  const { boxService, spritesClient, redis, logger } = deps;

  const worker = new Worker<DeleteBoxJobData>(
    WORKER_CONFIG.deleteBox.name,
    async (job: Job<DeleteBoxJobData>) => {
      const { boxId } = job.data;

      try {
        const boxResult = await boxService.getById(boxId);
        if (boxResult.isErr()) {
          throw new Error(boxResult.error.message);
        }
        const box = boxResult.value;
        if (!box?.spriteName) {
          logger.warn(
            { boxId },
            "Box has no sprite name, skipping sprite deletion"
          );
          return { success: true };
        }

        logger.info({ boxId, spriteName: box.spriteName }, "Deleting Sprite");
        await spritesClient.deleteSprite(box.spriteName);

        logger.info({ boxId }, "Sprite deleted successfully");
        return { success: true };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        logger.error({
          msg: "Failed to delete sprite",
          boxId,
          error: message,
        });
        throw error;
      }
    },
    {
      connection: redis,
      concurrency: 5,
    }
  );

  worker.on("failed", (job, err) => {
    logger.error({
      msg: "Delete job failed",
      jobId: job?.id,
      error: err.message,
    });
  });

  return worker;
}
