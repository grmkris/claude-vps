import type { Logger } from "@vps-claude/logger";
import type { Redis } from "@vps-claude/redis";
import type { SpritesClient } from "@vps-claude/sprites";

import {
  type DeployOrchestratorJobData,
  type DeployJobResult,
  DEPLOY_QUEUES,
  Worker,
  FlowProducer,
  type Job,
} from "@vps-claude/queue";
import { WORKER_CONFIG } from "@vps-claude/shared";

import type { BoxService } from "../../services/box.service";
import type { DeployStepService } from "../../services/deploy-step.service";
import type { EmailService } from "../../services/email.service";
import type { SecretService } from "../../services/secret.service";

import { buildDeployFlow } from "./flow-builder";

interface OrchestratorWorkerDeps {
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

/**
 * Orchestrator worker - coordinates the deploy flow
 *
 * Simplified responsibilities:
 * 1. Initialize step tracking in DB
 * 2. Prepare environment variables
 * 3. Create or retrieve sprite (synchronously - we need the result)
 * 4. Add the deployment flow DAG via FlowProducer
 *
 * All actual work (setup steps, health check, skills, etc.) is delegated
 * to individual workers via the BullMQ flow. Each worker handles its own
 * retries independently.
 */
export function createOrchestratorWorker({
  deps,
}: {
  deps: OrchestratorWorkerDeps;
}) {
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

  const flowProducer = new FlowProducer({ connection: redis });

  const worker = new Worker<DeployOrchestratorJobData, DeployJobResult>(
    DEPLOY_QUEUES.orchestrator,
    async (job: Job<DeployOrchestratorJobData>): Promise<DeployJobResult> => {
      const { boxId, userId, subdomain, skills, deploymentAttempt } = job.data;
      const attempt = deploymentAttempt ?? 1;
      const hasSkills = skills && skills.length > 0;

      logger.info(
        { boxId, subdomain, attempt, hasSkills, skillCount: skills?.length },
        "ORCHESTRATOR: Starting deployment flow"
      );

      try {
        // 1. Verify box exists
        const boxResult = await boxService.getById(boxId);
        if (boxResult.isErr()) {
          throw new Error(boxResult.error.message);
        }
        const box = boxResult.value;
        if (!box) {
          throw new Error("Box not found");
        }

        // 2. Initialize step tracking in DB
        await deployStepService.initializeSteps(boxId, attempt, {
          hasSkills,
          skills,
        });

        // 3. Prepare environment variables
        const envVars = await prepareEnvVars({
          userId,
          boxId,
          subdomain,
          secretService,
          emailService,
          serverUrl,
        });

        // 4. Get or create sprite (synchronous - we need spriteName/spriteUrl for flow)
        let spriteName = box.spriteName;
        let spriteUrl = box.spriteUrl;

        const createSpriteStep = await deployStepService.getStepByKey(
          boxId,
          attempt,
          "CREATE_SPRITE"
        );
        const needsCreateSprite =
          !createSpriteStep.isOk() ||
          !createSpriteStep.value ||
          createSpriteStep.value.status !== "completed";

        if (needsCreateSprite) {
          logger.info({ boxId }, "ORCHESTRATOR: Creating sprite");

          await deployStepService.updateStepStatus(
            boxId,
            attempt,
            "CREATE_SPRITE",
            "running"
          );

          try {
            const sprite = await spritesClient.createSprite({
              name: subdomain,
              userId,
              subdomain,
              envVars: {}, // Env vars injected during setup steps
            });
            spriteName = sprite.spriteName;
            spriteUrl = sprite.url;

            await boxService.setSpriteInfo(boxId, spriteName, spriteUrl);
            await deployStepService.updateStepStatus(
              boxId,
              attempt,
              "CREATE_SPRITE",
              "completed"
            );

            logger.info(
              { boxId, spriteName, spriteUrl },
              "ORCHESTRATOR: Sprite created"
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
        } else {
          logger.info(
            { boxId, spriteName },
            "ORCHESTRATOR: Sprite already created, skipping"
          );
        }

        if (!spriteName || !spriteUrl) {
          throw new Error("Sprite name or URL not available");
        }

        // 5. Mark SETUP_SERVICES as running (will be completed by last setup step)
        await deployStepService.updateStepStatus(
          boxId,
          attempt,
          "SETUP_SERVICES",
          "running"
        );

        // 6. Mark INSTALL_SKILLS as running if we have skills
        if (hasSkills) {
          await deployStepService.updateStepStatus(
            boxId,
            attempt,
            "INSTALL_SKILLS",
            "running"
          );
        }

        // 7. Add the deployment flow DAG
        const flow = buildDeployFlow({
          boxId,
          deploymentAttempt: attempt,
          spriteName,
          spriteUrl,
          envVars,
          boxAgentBinaryUrl,
          skills: skills ?? [],
        });

        await flowProducer.add(flow);

        logger.info(
          { boxId, subdomain, spriteName },
          "ORCHESTRATOR: Deployment flow added, jobs will execute"
        );

        return { success: true, spriteName, spriteUrl };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        logger.error(
          { boxId, error: message },
          "ORCHESTRATOR: Deployment setup failed"
        );
        await boxService.updateStatus(boxId, "error", message);
        throw error;
      }
    },
    {
      connection: redis,
      concurrency: WORKER_CONFIG.deployOrchestrator.concurrency,
      lockDuration: WORKER_CONFIG.deployOrchestrator.timeout,
    }
  );

  worker.on("failed", (job, err) => {
    logger.error({
      msg: "ORCHESTRATOR job failed",
      jobId: job?.id,
      boxId: job?.data.boxId,
      error: err.message,
    });
  });

  return { worker, flowProducer };
}

/**
 * Prepare environment variables for the sprite
 */
async function prepareEnvVars({
  userId,
  boxId,
  subdomain,
  secretService,
  emailService,
  serverUrl,
}: {
  userId: `usr_${string}`;
  boxId: `box_${string}`;
  subdomain: string;
  secretService: SecretService;
  emailService: EmailService;
  serverUrl: string;
}): Promise<Record<string, string>> {
  // Get user secrets
  const userSecretsResult = await secretService.getAll(userId);
  if (userSecretsResult.isErr()) {
    throw new Error(userSecretsResult.error.message);
  }
  const userSecrets = userSecretsResult.value;

  // Get or create email settings (generates BOX_AGENT_SECRET)
  const emailSettingsResult = await emailService.getOrCreateSettings(boxId);
  if (emailSettingsResult.isErr()) {
    throw new Error(emailSettingsResult.error.message);
  }
  const emailSettings = emailSettingsResult.value;

  return {
    ...userSecrets,
    BOX_AGENT_SECRET: emailSettings.agentSecret,
    BOX_API_TOKEN: emailSettings.agentSecret,
    BOX_API_URL: `${serverUrl}/box`,
    BOX_SUBDOMAIN: subdomain,
  };
}
