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

import type { BoxService } from "../services/box.service";
import type { DeployStepService } from "../services/deploy-step.service";
import type { EmailService } from "../services/email.service";
import type { SecretService } from "../services/secret.service";

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
  deployStepService: DeployStepService;
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
    deployStepService,
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
      const { boxId, userId, subdomain, skills, password, deploymentAttempt } =
        job.data;
      const attempt = deploymentAttempt ?? 1;
      const hasSkills = skills && skills.length > 0;
      const totalSteps = hasSkills ? 4 : 3;

      try {
        const boxResult = await boxService.getById(boxId);
        if (boxResult.isErr()) {
          throw new Error(boxResult.error.message);
        }
        const box = boxResult.value;
        if (!box) {
          throw new Error("Box not found");
        }

        await deployStepService.initializeSteps(boxId, attempt, {
          hasSkills,
          skills,
        });

        const resumePointResult = await deployStepService.getResumePoint(
          boxId,
          attempt
        );
        const resumeFromStep = resumePointResult.isOk()
          ? resumePointResult.value?.stepKey
          : undefined;

        logger.info({ boxId, attempt, resumeFromStep }, "Starting deployment");

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
          ...userSecrets,
          BOX_AGENT_SECRET: emailSettings.agentSecret,
          BOX_API_TOKEN: emailSettings.agentSecret,
          BOX_API_URL: `${serverUrl}/box`,
          BOX_SUBDOMAIN: subdomain,
        };

        await job.updateProgress({
          step: 1,
          total: totalSteps,
          message: "Creating sprite",
        });

        await deployStepService.updateStepStatus(
          boxId,
          attempt,
          "CREATE_SPRITE",
          "running"
        );

        logger.info({ boxId, subdomain }, "Creating Sprite");
        let sprite: { spriteName: string; url: string };
        try {
          sprite = await spritesClient.createSprite({
            name: subdomain,
            userId,
            subdomain,
            envVars: {}, // Env vars set during setup
          });
          await deployStepService.updateStepStatus(
            boxId,
            attempt,
            "CREATE_SPRITE",
            "completed"
          );
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : "Unknown error";
          await deployStepService.updateStepStatus(
            boxId,
            attempt,
            "CREATE_SPRITE",
            "failed",
            { errorMessage: errorMsg }
          );
          throw error;
        }

        await boxService.setSpriteInfo(boxId, sprite.spriteName, sprite.url);

        await job.updateProgress({
          step: 2,
          total: totalSteps,
          message: "Setting up services",
        });

        await deployStepService.updateStepStatus(
          boxId,
          attempt,
          "SETUP_SERVICES",
          "running"
        );

        const setupParentResult = await deployStepService.getStepByKey(
          boxId,
          attempt,
          "SETUP_SERVICES"
        );
        const setupParentId = setupParentResult.isOk()
          ? setupParentResult.value?.id
          : undefined;

        logger.info(
          { boxId, subdomain, spriteName: sprite.spriteName },
          "Setting up Sprite with all services"
        );

        try {
          await spritesClient.setupSprite({
            spriteName: sprite.spriteName,
            boxAgentBinaryUrl,
            envVars,
            password,
            spriteUrl: sprite.url,
            onProgress: async (stepKey, status, error) => {
              if (status === "start") {
                await deployStepService.updateStepStatus(
                  boxId,
                  attempt,
                  stepKey,
                  "running",
                  { parentId: setupParentId }
                );
              } else if (status === "complete") {
                await deployStepService.updateStepStatus(
                  boxId,
                  attempt,
                  stepKey,
                  "completed",
                  { parentId: setupParentId }
                );
              } else if (status === "error") {
                await deployStepService.updateStepStatus(
                  boxId,
                  attempt,
                  stepKey,
                  "failed",
                  { errorMessage: error, parentId: setupParentId }
                );
              }
            },
          });
          await deployStepService.updateStepStatus(
            boxId,
            attempt,
            "SETUP_SERVICES",
            "completed"
          );
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : "Unknown error";
          await deployStepService.updateStepStatus(
            boxId,
            attempt,
            "SETUP_SERVICES",
            "failed",
            { errorMessage: errorMsg }
          );
          throw error;
        }

        await job.updateProgress({
          step: 3,
          total: totalSteps,
          message: "Enabling public access",
        });

        await deployStepService.updateStepStatus(
          boxId,
          attempt,
          "ENABLE_PUBLIC_ACCESS",
          "running"
        );

        logger.info(
          { boxId, spriteName: sprite.spriteName },
          "Enabling public URL access"
        );

        try {
          await spritesClient.setUrlAuth(sprite.spriteName, "public");
          await deployStepService.updateStepStatus(
            boxId,
            attempt,
            "ENABLE_PUBLIC_ACCESS",
            "completed"
          );
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : "Unknown error";
          await deployStepService.updateStepStatus(
            boxId,
            attempt,
            "ENABLE_PUBLIC_ACCESS",
            "failed",
            { errorMessage: errorMsg }
          );
          throw error;
        }

        if (hasSkills) {
          await job.updateProgress({
            step: 4,
            total: totalSteps,
            message: "Installing skills",
          });

          await deployStepService.updateStepStatus(
            boxId,
            attempt,
            "INSTALL_SKILLS",
            "running"
          );

          const skillsParentResult = await deployStepService.getStepByKey(
            boxId,
            attempt,
            "INSTALL_SKILLS"
          );
          const skillsParentId = skillsParentResult.isOk()
            ? skillsParentResult.value?.id
            : undefined;

          logger.info(
            { boxId, skillCount: skills.length },
            "Installing skills.sh skills"
          );

          try {
            await spritesClient.execCommand(
              sprite.spriteName,
              "mkdir -p /home/coder/.claude/skills && chown -R coder:coder /home/coder/.claude"
            );

            const metadataResults = await Promise.all(
              skills.map(async (skillId) => {
                const metadata = await fetchSkillMetadata(skillId);
                return { skillId, metadata };
              })
            );

            const validSkills = metadataResults.filter((r) => r.metadata);
            const skillContents = await Promise.all(
              validSkills.map(async ({ skillId, metadata }) => {
                const skillMd = await fetchSkillMd(
                  metadata!.topSource,
                  skillId
                );
                return { skillId, skillMd };
              })
            );

            await Promise.all(
              skillContents
                .filter((s) => s.skillMd)
                .map(async ({ skillId, skillMd }) => {
                  const stepKey = `SKILL_${skillId}`;
                  await deployStepService.updateStepStatus(
                    boxId,
                    attempt,
                    stepKey,
                    "running",
                    { parentId: skillsParentId }
                  );

                  try {
                    const skillDir = `/home/coder/.claude/skills/${skillId}`;
                    await spritesClient.execCommand(
                      sprite.spriteName,
                      `mkdir -p ${skillDir} && chown coder:coder ${skillDir}`
                    );
                    await spritesClient.writeFile(
                      sprite.spriteName,
                      `${skillDir}/SKILL.md`,
                      skillMd!,
                      { mkdir: true }
                    );
                    await spritesClient.execCommand(
                      sprite.spriteName,
                      `chown coder:coder ${skillDir}/SKILL.md`
                    );
                    logger.info({ skillId }, "Installed skill");

                    await deployStepService.updateStepStatus(
                      boxId,
                      attempt,
                      stepKey,
                      "completed",
                      { parentId: skillsParentId }
                    );
                  } catch (err) {
                    const errorMsg =
                      err instanceof Error ? err.message : String(err);
                    logger.error(
                      { skillId, error: errorMsg },
                      "Failed to install skill"
                    );
                    await deployStepService.updateStepStatus(
                      boxId,
                      attempt,
                      stepKey,
                      "failed",
                      { errorMessage: errorMsg, parentId: skillsParentId }
                    );
                  }
                })
            );

            for (const { skillId, metadata } of metadataResults) {
              if (!metadata) {
                logger.warn(
                  { skillId },
                  "Could not find skill metadata, skipping"
                );
                await deployStepService.updateStepStatus(
                  boxId,
                  attempt,
                  `SKILL_${skillId}`,
                  "skipped",
                  { parentId: skillsParentId }
                );
              }
            }
            await deployStepService.updateStepStatus(
              boxId,
              attempt,
              "INSTALL_SKILLS",
              "completed"
            );
          } catch (error) {
            const errorMsg =
              error instanceof Error ? error.message : "Unknown error";
            await deployStepService.updateStepStatus(
              boxId,
              attempt,
              "INSTALL_SKILLS",
              "failed",
              { errorMessage: errorMsg }
            );
            throw error;
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
