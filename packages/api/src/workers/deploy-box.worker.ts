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

function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

/** Fetch skill metadata from skills.sh API */
async function fetchSkillMetadata(
  skillId: string
): Promise<{ topSource: string } | null> {
  try {
    const res = await fetch(
      `https://skills.sh/api/skills?search=${encodeURIComponent(skillId)}&limit=1`
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      skills: Array<{ id: string; topSource: string }>;
    };
    const skill = data.skills.find((s) => s.id === skillId);
    return skill ? { topSource: skill.topSource } : null;
  } catch {
    return null;
  }
}

/** Fetch SKILL.md content from GitHub raw URL */
async function fetchSkillMd(
  topSource: string,
  skillId: string
): Promise<string | null> {
  try {
    const url = `https://raw.githubusercontent.com/${topSource}/main/skills/${skillId}/SKILL.md`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

interface DeployWorkerDeps {
  boxService: BoxService;
  emailService: EmailService;
  secretService: SecretService;
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
      const { boxId, userId, subdomain, password, skills } = job.data;

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

        // Step 3: Install skills.sh skills
        if (skills && skills.length > 0) {
          logger.info(
            { boxId, skillCount: skills.length },
            "Installing skills.sh skills"
          );

          // Create skills directory
          await spritesClient.execCommand(
            sprite.spriteName,
            "mkdir -p /home/coder/.claude/skills && chown -R coder:coder /home/coder/.claude"
          );

          for (const skillId of skills) {
            try {
              // Fetch skill metadata to get topSource
              const metadata = await fetchSkillMetadata(skillId);
              if (!metadata) {
                logger.warn(
                  { skillId },
                  "Could not find skill metadata, skipping"
                );
                continue;
              }

              // Fetch SKILL.md content
              const skillMd = await fetchSkillMd(metadata.topSource, skillId);
              if (!skillMd) {
                logger.warn(
                  { skillId, topSource: metadata.topSource },
                  "Could not fetch SKILL.md, skipping"
                );
                continue;
              }

              // Create skill directory and write SKILL.md
              const skillDir = `/home/coder/.claude/skills/${skillId}`;
              await spritesClient.execCommand(
                sprite.spriteName,
                `mkdir -p ${skillDir} && chown coder:coder ${skillDir}`
              );

              // Write SKILL.md using filesystem API
              await spritesClient.writeFile(
                sprite.spriteName,
                `${skillDir}/SKILL.md`,
                skillMd,
                { mkdir: true }
              );

              // Set ownership
              await spritesClient.execCommand(
                sprite.spriteName,
                `chown coder:coder ${skillDir}/SKILL.md`
              );

              logger.info({ skillId }, "Installed skill");
            } catch (err) {
              logger.error(
                { skillId, error: err instanceof Error ? err.message : err },
                "Failed to install skill"
              );
            }
          }
        }

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
