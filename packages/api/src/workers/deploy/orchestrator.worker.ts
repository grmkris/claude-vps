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
import { SETUP_STEP_KEYS, type SetupStepKey } from "@vps-claude/sprites";

function isSetupStepKey(key: string): key is SetupStepKey {
  return (SETUP_STEP_KEYS as readonly string[]).includes(key);
}

import type { BoxEnvVarService } from "../../services/box-env-var.service";
import type { BoxService } from "../../services/box.service";
import type { DeployStepService } from "../../services/deploy-step.service";
import type { EmailService } from "../../services/email.service";

import { buildDeployFlow } from "./flow-builder";

interface OrchestratorWorkerDeps {
  boxService: BoxService;
  boxEnvVarService: BoxEnvVarService;
  deployStepService: DeployStepService;
  emailService: EmailService;
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
    boxEnvVarService,
    deployStepService,
    emailService,
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

        // 2. Initialize step tracking in DB (skip if steps already exist for resume)
        const existingSteps = await deployStepService.getStepsByBox(
          boxId,
          attempt
        );
        if (existingSteps.isErr() || existingSteps.value.length === 0) {
          await deployStepService.initializeSteps(boxId, attempt, {
            hasSkills,
            skills,
          });
        } else {
          logger.info(
            { boxId, existingCount: existingSteps.value.length },
            "ORCHESTRATOR: Steps already exist, skipping initialization"
          );
        }

        // 3. Prepare environment variables
        const envVars = await prepareEnvVars({
          userId,
          boxId,
          subdomain,
          boxEnvVarService,
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

        // 6. Resolve skill sources from skills.sh API (batch fetch)
        const skillsWithSources = await resolveSkillSources(
          skills ?? [],
          logger
        );

        // 7. Mark INSTALL_SKILLS as running if we have skills
        if (hasSkills) {
          await deployStepService.updateStepStatus(
            boxId,
            attempt,
            "INSTALL_SKILLS",
            "running"
          );
        }

        // 8. Get completed steps for resumable deployments
        const { completedStepKeys, completedSkillIds } =
          await getCompletedSteps(deployStepService, boxId, attempt);

        // 9. Reset any failed steps to pending for retry
        const resetCount = await deployStepService.resetFailedSteps(
          boxId,
          attempt
        );
        if (resetCount.isOk() && resetCount.value > 0) {
          logger.info(
            { boxId, resetCount: resetCount.value },
            "ORCHESTRATOR: Reset failed steps to pending"
          );
        }

        // 10. Add the deployment flow DAG (skipping completed steps)
        // Use unique suffix for job IDs when resuming/retrying to prevent BullMQ deduplication
        const isResume =
          completedStepKeys.length > 0 ||
          (resetCount.isOk() && resetCount.value > 0);
        const jobIdSuffix = isResume ? `-r${Date.now().toString(36)}` : "";

        const flow = buildDeployFlow({
          boxId,
          deploymentAttempt: attempt,
          spriteName,
          spriteUrl,
          envVars,
          boxAgentBinaryUrl,
          skillsWithSources,
          completedStepKeys,
          completedSkillIds,
          jobIdSuffix,
        });

        logger.info(
          {
            boxId,
            completedSetupSteps: completedStepKeys.length,
            completedSkills: completedSkillIds.length,
            totalSetupSteps: SETUP_STEP_KEYS.length,
            totalSkills: skillsWithSources.length,
            isResume,
            jobIdSuffix: jobIdSuffix || "(none)",
          },
          "ORCHESTRATOR: Building flow with resume support"
        );

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
  boxEnvVarService,
  emailService,
  serverUrl,
}: {
  userId: `usr_${string}`;
  boxId: `box_${string}`;
  subdomain: string;
  boxEnvVarService: BoxEnvVarService;
  emailService: EmailService;
  serverUrl: string;
}): Promise<Record<string, string>> {
  // Resolve box env vars (literals + credential references)
  const boxEnvVarsResult = await boxEnvVarService.resolveAll(boxId, userId);
  if (boxEnvVarsResult.isErr()) {
    throw new Error(boxEnvVarsResult.error.message);
  }
  const boxEnvVars = boxEnvVarsResult.value;

  // Get or create email settings (generates BOX_AGENT_SECRET)
  const emailSettingsResult = await emailService.getOrCreateSettings(boxId);
  if (emailSettingsResult.isErr()) {
    throw new Error(emailSettingsResult.error.message);
  }
  const emailSettings = emailSettingsResult.value;

  return {
    ...boxEnvVars,
    APP_ENV: "prod",
    BOX_AGENT_SECRET: emailSettings.agentSecret,
    BOX_API_TOKEN: emailSettings.agentSecret,
    BOX_API_URL: `${serverUrl}/box`,
    BOX_SUBDOMAIN: subdomain,
  };
}

/**
 * Resolve skill sources from skills.sh API
 * Batch-fetches all skill metadata in one request
 */
async function resolveSkillSources(
  skills: string[],
  logger: Logger
): Promise<Array<{ skillId: string; topSource?: string }>> {
  if (skills.length === 0) return [];

  try {
    logger.info(
      { skillCount: skills.length },
      "ORCHESTRATOR: Resolving skill sources"
    );
    const res = await fetch("https://skills.sh/api/skills?limit=100");
    if (!res.ok) {
      logger.warn(
        "ORCHESTRATOR: Failed to fetch skills.sh API, skills will be skipped"
      );
      return skills.map((skillId) => ({ skillId, topSource: undefined }));
    }

    const data = (await res.json()) as {
      skills: Array<{ id: string; topSource: string }>;
    };

    const result = skills.map((skillId) => {
      const skill = data.skills.find((s) => s.id === skillId);
      if (!skill) {
        logger.warn({ skillId }, "ORCHESTRATOR: Skill not found in skills.sh");
      }
      return { skillId, topSource: skill?.topSource };
    });

    logger.info(
      {
        resolved: result.filter((s) => s.topSource).length,
        total: skills.length,
      },
      "ORCHESTRATOR: Skill sources resolved"
    );
    return result;
  } catch (error) {
    logger.warn({ error }, "ORCHESTRATOR: Error fetching skill sources");
    return skills.map((skillId) => ({ skillId, topSource: undefined }));
  }
}

/**
 * Get completed step keys for resumable deployments
 */
async function getCompletedSteps(
  deployStepService: DeployStepService,
  boxId: `box_${string}`,
  attempt: number
): Promise<{ completedStepKeys: string[]; completedSkillIds: string[] }> {
  const stepsResult = await deployStepService.getStepsByBox(boxId, attempt);

  if (stepsResult.isErr()) {
    return { completedStepKeys: [], completedSkillIds: [] };
  }

  const steps = stepsResult.value;

  // Get completed setup step keys
  const completedStepKeys = steps
    .filter((s) => s.status === "completed" && isSetupStepKey(s.stepKey))
    .map((s) => s.stepKey);

  // Get completed skill IDs (step key format: SKILL_{skillId})
  const completedSkillIds = steps
    .filter((s) => s.status === "completed" && s.stepKey.startsWith("SKILL_"))
    .map((s) => s.stepKey.replace("SKILL_", ""));

  return { completedStepKeys, completedSkillIds };
}
