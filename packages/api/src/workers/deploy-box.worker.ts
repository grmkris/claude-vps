import type { Logger } from "@vps-claude/logger";
import type { Redis } from "@vps-claude/redis";

import { DockerEngineClient } from "@vps-claude/docker-engine";
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
  dockerClient: DockerEngineClient;
  redis: Redis;
  logger: Logger;
  serverUrl: string;
  baseImageName: string;
}

interface DeleteWorkerDeps {
  boxService: BoxService;
  dockerClient: DockerEngineClient;
  redis: Redis;
  logger: Logger;
}

export function createDeployWorker({ deps }: { deps: DeployWorkerDeps }) {
  const {
    boxService,
    emailService,
    secretService,
    dockerClient,
    redis,
    logger,
    serverUrl,
    baseImageName,
  } = deps;

  const worker = new Worker<DeployBoxJobData>(
    WORKER_CONFIG.deployBox.name,
    async (job: Job<DeployBoxJobData>) => {
      const { boxId, userId, subdomain, password } = job.data;

      try {
        const box = await boxService.getById(boxId);
        if (!box) {
          throw new Error("Box not found");
        }

        // Get user secrets
        const userSecrets = await secretService.getAll(userId);

        // Get or create email settings
        const emailSettingsResult =
          await emailService.getOrCreateSettings(boxId);
        if (emailSettingsResult.isErr()) {
          throw new Error(emailSettingsResult.error.message);
        }
        const emailSettings = emailSettingsResult.value;

        // Build environment variables
        const envVars: Record<string, string> = {
          PASSWORD: password,
          ...userSecrets,
          BOX_AGENT_SECRET: emailSettings.agentSecret,
          BOX_API_TOKEN: emailSettings.agentSecret,
          BOX_API_URL: `${serverUrl}/box`,
          BOX_SUBDOMAIN: subdomain,
        };

        // Add Telegram config if present
        if (box.telegramBotToken) {
          envVars.TAKOPI_BOT_TOKEN = box.telegramBotToken;
        }
        if (box.telegramChatId) {
          envVars.TAKOPI_CHAT_ID = box.telegramChatId;
        }

        // Generate unique container name
        const containerName = `box-${subdomain}`;

        // Create and start container
        logger.info({ boxId, subdomain }, "Creating Docker container");
        const container = await dockerClient.createBox({
          userId,
          boxId,
          subdomain,
          name: containerName,
          image: baseImageName,
          envVars,
          exposedPorts: [3000], // Default user app port
        });

        // Update box record with Docker info
        await boxService.setDockerInfo(
          boxId,
          container.id,
          containerName,
          baseImageName
        );
        await boxService.setContainerInfo(
          boxId,
          containerName,
          hashPassword(password)
        );

        // Wait for container to become healthy
        logger.info(
          { boxId, containerId: container.id },
          "Waiting for container health check"
        );
        const isHealthy = await dockerClient.waitForHealth(
          container.id,
          WORKER_CONFIG.deployBox.healthCheckTimeout
        );

        if (!isHealthy) {
          await boxService.updateStatus(
            boxId,
            "error",
            "Container failed health check"
          );
          return { success: false, error: "health_check_failed" };
        }

        // Mark as running
        await boxService.updateStatus(boxId, "running");
        logger.info({ boxId, subdomain }, "Box deployed successfully");

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
  const { dockerClient, redis, logger } = deps;

  const worker = new Worker<DeleteBoxJobData>(
    WORKER_CONFIG.deleteBox.name,
    async (job: Job<DeleteBoxJobData>) => {
      const { boxId, userId, dockerContainerId } = job.data;

      try {
        logger.info({ boxId, dockerContainerId }, "Deleting Docker container");

        // Delete container and clean up resources
        await dockerClient.deleteBox(dockerContainerId, userId, boxId);

        logger.info({ boxId }, "Box deleted successfully");
        return { success: true };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        logger.error({
          msg: "Failed to delete box",
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
