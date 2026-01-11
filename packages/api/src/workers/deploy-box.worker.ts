import type { CoolifyClient } from "@vps-claude/coolify";
import type { Logger } from "@vps-claude/logger";
import type { Redis } from "@vps-claude/redis";

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
  coolifyClient: CoolifyClient;
  redis: Redis;
  logger: Logger;
  serverUrl: string;
}

interface DeleteWorkerDeps {
  boxService: BoxService;
  coolifyClient: CoolifyClient;
  redis: Redis;
  logger: Logger;
}

export function createDeployWorker({ deps }: { deps: DeployWorkerDeps }) {
  const {
    boxService,
    emailService,
    secretService,
    skillService,
    coolifyClient,
    redis,
    logger,
    serverUrl,
  } = deps;

  const worker = new Worker<DeployBoxJobData>(
    WORKER_CONFIG.deployBox.name,
    async (job: Job<DeployBoxJobData>) => {
      const { boxId, userId, subdomain, password, skills: skillIds } = job.data;

      try {
        const box = await boxService.getById(boxId);
        if (!box) {
          throw new Error("Box not found");
        }

        const skills = await skillService.getByIds(skillIds, userId);

        const skillPackages = {
          aptPackages: [...new Set(skills.flatMap((s) => s.aptPackages))],
          npmPackages: [...new Set(skills.flatMap((s) => s.npmPackages))],
          pipPackages: [...new Set(skills.flatMap((s) => s.pipPackages))],
        };

        const skillMdFiles = skills
          .filter((s) => s.skillMdContent)
          .map((s) => ({ slug: s.slug, content: s.skillMdContent! }));

        const app = (
          await coolifyClient.createApplication({
            subdomain,
            password,
            claudeMdContent: "",
            skillPackages,
            skillMdFiles,
          })
        ).match(
          (v) => v,
          (e) => {
            throw new Error(`${e.type}: ${e.message}`);
          }
        );
        await boxService.setCoolifyUuid(boxId, app.uuid);
        await boxService.setContainerInfo(
          boxId,
          app.containerName,
          hashPassword(password)
        );

        const userSecrets = await secretService.getAll(userId);
        const emailSettingsResult =
          await emailService.getOrCreateSettings(boxId);
        if (emailSettingsResult.isErr()) {
          throw new Error(emailSettingsResult.error.message);
        }
        const emailSettings = emailSettingsResult.value;

        const envVars = {
          ...userSecrets,
          BOX_AGENT_SECRET: emailSettings.agentSecret,
          BOX_API_TOKEN: emailSettings.agentSecret, // Per-box auth token for box API
          BOX_API_URL: `${serverUrl}/box`,
          BOX_SUBDOMAIN: subdomain,
          ...(box.telegramBotToken && {
            TAKOPI_BOT_TOKEN: box.telegramBotToken,
          }),
          ...(box.telegramChatId && { TAKOPI_CHAT_ID: box.telegramChatId }),
        };

        const envResult = await coolifyClient.updateApplicationEnv(
          app.uuid,
          envVars
        );
        if (envResult.isErr()) {
          logger.warn({ uuid: app.uuid }, "Failed to inject env vars");
        }

        const { deploymentUuid } = (
          await coolifyClient.deployApplication(app.uuid)
        ).match(
          (v) => v,
          (e) => {
            throw new Error(`${e.type}: ${e.message}`);
          }
        );

        const deployResult = await coolifyClient.waitForDeployment(
          deploymentUuid,
          {
            pollIntervalMs: WORKER_CONFIG.deployBox.pollInterval,
            timeoutMs: WORKER_CONFIG.deployBox.buildTimeout,
          }
        );

        if (deployResult.isErr()) {
          await boxService.updateStatus(
            boxId,
            "error",
            deployResult.error.message
          );
          return { success: false, error: deployResult.error.message };
        }

        if (deployResult.value.status === "failed") {
          await boxService.updateStatus(
            boxId,
            "error",
            "Deployment build failed"
          );
          return { success: false, error: "build_failed" };
        }

        const healthResult = await coolifyClient.waitForHealthy(app.uuid, {
          pollIntervalMs: WORKER_CONFIG.deployBox.pollInterval,
          timeoutMs: WORKER_CONFIG.deployBox.healthCheckTimeout,
        });

        if (healthResult.isErr()) {
          await boxService.updateStatus(
            boxId,
            "error",
            healthResult.error.message
          );
          return { success: false, error: healthResult.error.message };
        }

        await boxService.updateStatus(boxId, "running");
        return { success: true };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
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
  const { coolifyClient, redis, logger } = deps;

  const worker = new Worker<DeleteBoxJobData>(
    WORKER_CONFIG.deleteBox.name,
    async (job: Job<DeleteBoxJobData>) => {
      const { coolifyApplicationUuid } = job.data;

      try {
        (await coolifyClient.deleteApplication(coolifyApplicationUuid)).match(
          (v) => v,
          (e) => {
            throw new Error(`${e.type}: ${e.message}`);
          }
        );
        return { success: true };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        logger.error({
          msg: "Failed to delete application",
          uuid: coolifyApplicationUuid,
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
