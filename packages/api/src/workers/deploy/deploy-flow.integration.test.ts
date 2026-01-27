import { createLogger } from "@vps-claude/logger";
import { createSpritesClient, type SpritesClient } from "@vps-claude/sprites";
import { createTestSetup, type TestSetup } from "@vps-claude/test-utils";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createBoxService, type BoxService } from "../../services/box.service";
import {
  createDeployStepService,
  type DeployStepService,
} from "../../services/deploy-step.service";
import {
  createEmailService,
  type EmailService,
} from "../../services/email.service";
import {
  createSecretService,
  type SecretService,
} from "../../services/secret.service";
import {
  createOrchestratorWorker,
  createSetupStepWorker,
  createHealthCheckWorker,
  createInstallSkillWorker,
  createEnableAccessWorker,
  createFinalizeWorker,
  createSkillsGateWorker,
} from "./index";

const logger = createLogger({ appName: "deploy-flow-integration-test" });
const SPRITES_TOKEN = process.env.SPRITES_TOKEN;

// Default box-agent binary URL from GitHub releases
const BOX_AGENT_BINARY_URL =
  process.env.BOX_AGENT_BINARY_URL ||
  "https://github.com/grmkris/claude-vps/releases/latest/download/box-agent-linux-x64";

describe.skipIf(!SPRITES_TOKEN)("Deploy Flow Integration", () => {
  let testEnv: TestSetup;
  let spritesClient: SpritesClient;

  // Services
  let boxService: BoxService;
  let deployStepService: DeployStepService;
  let secretService: SecretService;
  let emailService: EmailService;

  // Workers
  let orchestratorWorker: Awaited<
    ReturnType<typeof createOrchestratorWorker>
  >["worker"];
  let flowProducer: Awaited<
    ReturnType<typeof createOrchestratorWorker>
  >["flowProducer"];
  let setupStepWorker: ReturnType<typeof createSetupStepWorker>;
  let healthCheckWorker: ReturnType<typeof createHealthCheckWorker>;
  let installSkillWorker: ReturnType<typeof createInstallSkillWorker>;
  let enableAccessWorker: ReturnType<typeof createEnableAccessWorker>;
  let finalizeWorker: ReturnType<typeof createFinalizeWorker>;
  let skillsGateWorker: ReturnType<typeof createSkillsGateWorker>;

  // Track sprite for cleanup
  let createdSpriteName: string | null = null;

  beforeAll(async () => {
    testEnv = await createTestSetup();
    spritesClient = createSpritesClient({
      token: SPRITES_TOKEN!,
      logger,
    });

    // Create services
    boxService = createBoxService({
      deps: {
        db: testEnv.db,
        queueClient: testEnv.deps.queue,
        spritesClient,
      },
    });

    deployStepService = createDeployStepService({
      deps: { db: testEnv.db },
    });

    secretService = createSecretService({
      deps: { db: testEnv.db, spritesClient },
    });

    emailService = createEmailService({
      deps: { db: testEnv.db, queueClient: testEnv.deps.queue },
    });

    // Create all deploy flow workers
    const baseDeps = {
      boxService,
      deployStepService,
      spritesClient,
      redis: testEnv.deps.redis,
      logger,
    };

    // Orchestrator returns { worker, flowProducer }
    const orchestratorResult = createOrchestratorWorker({
      deps: {
        ...baseDeps,
        emailService,
        secretService,
        serverUrl: "http://localhost:33000",
        boxAgentBinaryUrl: BOX_AGENT_BINARY_URL,
      },
    });
    orchestratorWorker = orchestratorResult.worker;
    flowProducer = orchestratorResult.flowProducer;

    setupStepWorker = createSetupStepWorker({ deps: baseDeps });
    healthCheckWorker = createHealthCheckWorker({ deps: baseDeps });
    installSkillWorker = createInstallSkillWorker({
      deps: {
        deployStepService,
        spritesClient,
        redis: testEnv.deps.redis,
        logger,
      },
    });
    enableAccessWorker = createEnableAccessWorker({ deps: baseDeps });
    finalizeWorker = createFinalizeWorker({
      deps: {
        boxService,
        redis: testEnv.deps.redis,
        logger,
      },
    });
    skillsGateWorker = createSkillsGateWorker({
      deps: {
        deployStepService,
        redis: testEnv.deps.redis,
        logger,
      },
    });
  }, 60_000);

  afterAll(async () => {
    // Close workers
    await orchestratorWorker.close();
    await flowProducer.close();
    await setupStepWorker.close();
    await healthCheckWorker.close();
    await installSkillWorker.close();
    await enableAccessWorker.close();
    await finalizeWorker.close();
    await skillsGateWorker.close();

    // Cleanup sprite if created
    if (createdSpriteName) {
      try {
        await spritesClient.deleteSprite(createdSpriteName);
        logger.info(
          { spriteName: createdSpriteName },
          "Cleaned up test sprite"
        );
      } catch (error) {
        logger.warn(
          { spriteName: createdSpriteName, error },
          "Failed to cleanup sprite"
        );
      }
    }

    await testEnv.close();
  }, 30_000);

  it("deploys box through full FlowProducer DAG", async () => {
    const testSuffix = Date.now().toString(36);
    const boxName = `flow-int-test-${testSuffix}`;

    // 1. Create box (queues orchestrator job)
    logger.info({ boxName }, "Creating box...");
    const boxResult = await boxService.create(testEnv.users.authenticated.id, {
      name: boxName,
    });

    expect(boxResult.isOk()).toBe(true);
    const box = boxResult._unsafeUnwrap();
    expect(box.status).toBe("deploying");
    logger.info({ boxId: box.id, subdomain: box.subdomain }, "Box created");

    // 2. Poll until flow completes
    const maxWait = 5 * 60 * 1000; // 5 minutes
    const pollInterval = 5000; // 5 seconds
    let elapsed = 0;
    let finalBox = box;

    while (elapsed < maxWait) {
      await new Promise((r) => setTimeout(r, pollInterval));
      elapsed += pollInterval;

      const result = await boxService.getById(box.id);
      expect(result.isOk()).toBe(true);
      const currentBox = result._unsafeUnwrap();

      if (!currentBox) {
        throw new Error("Box disappeared during deployment");
      }

      finalBox = currentBox;
      logger.info(
        {
          elapsed: `${elapsed / 1000}s`,
          status: finalBox.status,
          spriteName: finalBox.spriteName,
        },
        "Polling box status"
      );

      // Track sprite for cleanup
      if (finalBox.spriteName && !createdSpriteName) {
        createdSpriteName = finalBox.spriteName;
      }

      if (finalBox.status === "running" || finalBox.status === "error") {
        break;
      }
    }

    // 3. Verify final state
    expect(finalBox.status).toBe("running");
    expect(finalBox.spriteName).toBeDefined();
    expect(finalBox.spriteUrl).toBeDefined();

    logger.info(
      {
        boxId: finalBox.id,
        spriteName: finalBox.spriteName,
        spriteUrl: finalBox.spriteUrl,
        status: finalBox.status,
      },
      "Box deployment completed"
    );

    // 4. Verify all top-level deploy steps completed
    const stepsResult = await deployStepService.getSteps(box.id, 1);
    expect(stepsResult.isOk()).toBe(true);
    const { steps } = stepsResult._unsafeUnwrap();
    const topLevel = steps.filter((s) => !s.parentId);

    logger.info({ stepCount: topLevel.length }, "Verifying deploy steps");

    for (const step of topLevel) {
      logger.info(
        { stepKey: step.stepKey, status: step.status },
        "Step status"
      );
      expect(step.status).toBe("completed");
    }

    // 5. Verify health check passed
    const healthStep = steps.find((s) => s.stepKey === "HEALTH_CHECK");
    expect(healthStep).toBeDefined();
    expect(healthStep?.status).toBe("completed");

    // 6. Verify public access enabled
    const accessStep = steps.find((s) => s.stepKey === "ENABLE_PUBLIC_ACCESS");
    expect(accessStep).toBeDefined();
    expect(accessStep?.status).toBe("completed");

    logger.info("All assertions passed - deployment flow working correctly");
  }, 600_000); // 10 minute timeout
});
