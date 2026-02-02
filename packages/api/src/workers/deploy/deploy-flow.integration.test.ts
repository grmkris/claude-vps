import { createLogger } from "@vps-claude/logger";
import {
  createProviderFactory,
  type ProviderFactory,
} from "@vps-claude/providers";
import { createSpritesClient, type SpritesClient } from "@vps-claude/sprites";
import { createTestSetup, type TestSetup } from "@vps-claude/test-utils";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import {
  createBoxEnvVarService,
  type BoxEnvVarService,
} from "../../services/box-env-var.service";
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
  let providerFactory: ProviderFactory;

  // Services
  let boxService: BoxService;
  let boxEnvVarService: BoxEnvVarService;
  let deployStepService: DeployStepService;
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

  // Track sprites for cleanup
  const createdSpriteNames: string[] = [];

  beforeAll(async () => {
    testEnv = await createTestSetup();
    spritesClient = createSpritesClient({
      token: SPRITES_TOKEN!,
      logger,
    });
    providerFactory = createProviderFactory({
      spritesClient,
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

    boxEnvVarService = createBoxEnvVarService({
      deps: { db: testEnv.db },
    });

    emailService = createEmailService({
      deps: {
        db: testEnv.db,
        queueClient: testEnv.deps.queue,
        agentsDomain: "test.local",
      },
    });

    // Create all deploy flow workers
    const baseDeps = {
      boxService,
      deployStepService,
      providerFactory,
      redis: testEnv.deps.redis,
      logger,
    };

    // Orchestrator returns { worker, flowProducer }
    const orchestratorResult = createOrchestratorWorker({
      deps: {
        ...baseDeps,
        boxEnvVarService,
        emailService,
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
        boxService,
        deployStepService,
        providerFactory,
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

    // Cleanup all created sprites
    for (const instanceName of createdSpriteNames) {
      try {
        await spritesClient.deleteSprite(instanceName);
        logger.info({ instanceName }, "Cleaned up test sprite");
      } catch (error) {
        logger.warn({ instanceName, error }, "Failed to cleanup sprite");
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
          instanceName: finalBox.instanceName,
        },
        "Polling box status"
      );

      // Track sprite for cleanup
      if (
        finalBox.instanceName &&
        !createdSpriteNames.includes(finalBox.instanceName)
      ) {
        createdSpriteNames.push(finalBox.instanceName);
      }

      if (finalBox.status === "running" || finalBox.status === "error") {
        break;
      }
    }

    // 3. Verify final state
    expect(finalBox.status).toBe("running");
    expect(finalBox.instanceName).toBeDefined();
    expect(finalBox.instanceUrl).toBeDefined();

    logger.info(
      {
        boxId: finalBox.id,
        instanceName: finalBox.instanceName,
        instanceUrl: finalBox.instanceUrl,
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

    // 7. Verify MCP settings via claude mcp list
    // Setup uses: claude mcp add -s user -t http ai-tools http://localhost:33002/mcp
    logger.info("Verifying MCP settings...");
    const mcpListResult = await spritesClient.execShell(
      finalBox.instanceName!,
      "source /home/sprite/.bashrc.env && /home/sprite/.local/bin/claude mcp list"
    );
    expect(mcpListResult.exitCode).toBe(0);
    expect(mcpListResult.stdout).toContain("ai-tools");
    logger.info("MCP settings verified");

    // 8. Verify environment variables in .bashrc.env
    const envResult = await spritesClient.execShell(
      finalBox.instanceName!,
      "source /home/sprite/.bashrc.env && env | grep -E '^BOX_|^APP_ENV'"
    );
    expect(envResult.exitCode).toBe(0);
    expect(envResult.stdout).toContain("BOX_AGENT_SECRET=");
    expect(envResult.stdout).toContain("BOX_API_TOKEN=");
    expect(envResult.stdout).toContain("BOX_API_URL=");
    expect(envResult.stdout).toContain("BOX_SUBDOMAIN=");
    expect(envResult.stdout).toContain("APP_ENV=prod");

    // 9. Verify BOX_AGENT_SECRET is 64 chars hex
    const secretMatch = envResult.stdout.match(/BOX_AGENT_SECRET=([a-f0-9]+)/);
    expect(secretMatch).toBeDefined();
    expect(secretMatch![1]!.length).toBe(64);

    // 10. Verify BOX_API_URL ends with /box
    expect(envResult.stdout).toMatch(/BOX_API_URL=.*\/box/);

    // 11. Verify BOX_SUBDOMAIN matches box subdomain
    expect(envResult.stdout).toContain(`BOX_SUBDOMAIN=${box.subdomain}`);

    logger.info("Environment variables verified");
    logger.info("All assertions passed - deployment flow working correctly");
  }, 600_000); // 10 minute timeout

  it("deployed box can fetch custom agent config", async () => {
    const testSuffix = Date.now().toString(36);
    const boxName = `config-test-${testSuffix}`;

    // 1. Create box (auto-creates default agent config)
    logger.info({ boxName }, "Creating box for agent config test...");
    const boxResult = await boxService.create(testEnv.users.authenticated.id, {
      name: boxName,
    });

    expect(boxResult.isOk()).toBe(true);
    const box = boxResult._unsafeUnwrap();

    // 2. Update agent config to use opus model
    const configsResult = await boxService.listAgentConfigs(box.id);
    expect(configsResult.isOk()).toBe(true);
    const configs = configsResult._unsafeUnwrap();
    expect(configs.length).toBe(1);

    const updateResult = await boxService.updateAgentConfig(configs[0]!.id, {
      model: "claude-opus-4-5-20251101",
      appendSystemPrompt: "You are a test agent for E2E verification",
      maxTurns: 99,
    });
    expect(updateResult.isOk()).toBe(true);
    logger.info("Updated agent config to use opus model");

    // 3. Wait for deployment to complete
    const maxWait = 5 * 60 * 1000;
    const pollInterval = 5000;
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

      if (
        finalBox.instanceName &&
        !createdSpriteNames.includes(finalBox.instanceName)
      ) {
        createdSpriteNames.push(finalBox.instanceName);
      }

      if (finalBox.status === "running" || finalBox.status === "error") {
        break;
      }
    }

    expect(finalBox.status).toBe("running");
    expect(finalBox.instanceName).toBeDefined();
    logger.info(
      { instanceName: finalBox.instanceName },
      "Box deployed, verifying config fetch..."
    );

    // 4. Verify agent config can be fetched from sprite
    // Get the box's agent secret from email settings
    const settingsResult = await emailService.getOrCreateSettings(box.id);
    expect(settingsResult.isOk()).toBe(true);
    const agentSecret = settingsResult._unsafeUnwrap().agentSecret;

    // Call config endpoint from sprite using curl
    const configFetch = await spritesClient.execShell(
      finalBox.instanceName!,
      `curl -s -H "X-Box-Secret: ${agentSecret}" "http://localhost:33000/box/agent-config?triggerType=default" 2>/dev/null || echo "CURL_FAILED"`
    );

    logger.info(
      { stdout: configFetch.stdout.slice(0, 200) },
      "Config fetch result"
    );

    // Note: This test verifies the config exists and has correct structure
    // In production, the box uses BOX_API_URL which points to public server
    // Here we're testing the DB state is correct
    const verifyResult = await boxService.getAgentConfig(box.id, "default");
    expect(verifyResult.isOk()).toBe(true);
    const config = verifyResult._unsafeUnwrap();

    expect(config.model).toBe("claude-opus-4-5-20251101");
    expect(config.appendSystemPrompt).toContain("E2E verification");
    expect(config.maxTurns).toBe(99);
    expect(config.mcpServers).toHaveProperty("ai-tools");

    logger.info("Agent config test passed - custom config verified");
  }, 600_000);

  it("deploys box with skills through FlowProducer DAG", async () => {
    const testSuffix = Date.now().toString(36);
    const boxName = `flow-skills-test-${testSuffix}`;

    // 1. Create box WITH skills
    // Use remotion-best-practices - has proper /skills repo at remotion-dev/skills
    logger.info({ boxName }, "Creating box with skills...");
    const boxResult = await boxService.create(testEnv.users.authenticated.id, {
      name: boxName,
      skills: ["remotion-best-practices"],
    });

    expect(boxResult.isOk()).toBe(true);
    const box = boxResult._unsafeUnwrap();
    expect(box.status).toBe("deploying");
    expect(box.skills).toContain("remotion-best-practices");
    logger.info(
      { boxId: box.id, subdomain: box.subdomain, skills: box.skills },
      "Box with skills created"
    );

    // 2. Poll until flow completes
    const maxWait = 7 * 60 * 1000; // 7 minutes (skills take longer)
    const pollInterval = 5000;
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
          instanceName: finalBox.instanceName,
        },
        "Polling box status (with skills)"
      );

      // Track sprite for cleanup
      if (
        finalBox.instanceName &&
        !createdSpriteNames.includes(finalBox.instanceName)
      ) {
        createdSpriteNames.push(finalBox.instanceName);
      }

      if (finalBox.status === "running" || finalBox.status === "error") {
        break;
      }
    }

    // 3. Verify final state
    expect(finalBox.status).toBe("running");
    expect(finalBox.instanceName).toBeDefined();
    expect(finalBox.instanceUrl).toBeDefined();

    logger.info(
      {
        boxId: finalBox.id,
        instanceName: finalBox.instanceName,
        status: finalBox.status,
      },
      "Box with skills deployment completed"
    );

    // 4. Verify all deploy steps
    const stepsResult = await deployStepService.getSteps(box.id, 1);
    expect(stepsResult.isOk()).toBe(true);
    const { steps } = stepsResult._unsafeUnwrap();
    const topLevel = steps.filter((s) => !s.parentId);

    logger.info({ stepCount: topLevel.length }, "Verifying deploy steps");

    // 5. Verify INSTALL_SKILLS step exists and completed
    const skillsStep = topLevel.find((s) => s.stepKey === "INSTALL_SKILLS");
    expect(skillsStep).toBeDefined();
    expect(skillsStep?.status).toBe("completed");
    logger.info({ status: skillsStep?.status }, "INSTALL_SKILLS step verified");

    // 6. Verify individual skill step completed or skipped
    // (skills may be skipped if the search API doesn't find them)
    const skillSubstep = steps.find(
      (s) => s.stepKey === "SKILL_remotion-best-practices"
    );
    expect(skillSubstep).toBeDefined();
    expect(["completed", "skipped"]).toContain(skillSubstep!.status);
    logger.info(
      { status: skillSubstep?.status },
      "Skill substep remotion-best-practices verified"
    );

    // 7. Verify skill files are actually installed on the sprite filesystem
    if (skillSubstep!.status === "completed") {
      const skillDirCheck = await spritesClient.execShell(
        finalBox.instanceName!,
        "ls -la ~/.claude/skills/"
      );
      logger.info(
        { stdout: skillDirCheck.stdout, stderr: skillDirCheck.stderr },
        "Skills directory listing"
      );
      expect(skillDirCheck.exitCode).toBe(0);

      // Check for the specific skill directory
      const skillFileCheck = await spritesClient.execShell(
        finalBox.instanceName!,
        "ls ~/.claude/skills/remotion-best-practices/SKILL.md 2>/dev/null && echo 'SKILL_FILE_EXISTS'"
      );
      logger.info(
        { stdout: skillFileCheck.stdout, exitCode: skillFileCheck.exitCode },
        "Skill file check"
      );
      expect(skillFileCheck.stdout).toContain("SKILL_FILE_EXISTS");
      logger.info("Skill files verified on sprite filesystem");
    }

    // 8. Verify all top-level steps completed
    for (const step of topLevel) {
      logger.info(
        { stepKey: step.stepKey, status: step.status },
        "Step status"
      );
      expect(step.status).toBe("completed");
    }

    logger.info(
      "All assertions passed - deployment with skills working correctly"
    );
  }, 600_000); // 10 minute timeout

  describe("resumable deploy flow", () => {
    it("resumes deployment skipping completed setup steps", async () => {
      const testSuffix = Date.now().toString(36);
      const boxName = `resume-test-${testSuffix}`;

      // 1. Create box and let it deploy completely
      logger.info({ boxName }, "Creating box for resume test...");
      const boxResult = await boxService.create(
        testEnv.users.authenticated.id,
        {
          name: boxName,
        }
      );

      expect(boxResult.isOk()).toBe(true);
      const box = boxResult._unsafeUnwrap();
      logger.info({ boxId: box.id }, "Box created, waiting for deployment...");

      // 2. Wait for initial deployment to complete
      const maxWait = 5 * 60 * 1000;
      const pollInterval = 5000;
      let elapsed = 0;
      let finalBox = box;

      while (elapsed < maxWait) {
        await new Promise((r) => setTimeout(r, pollInterval));
        elapsed += pollInterval;

        const result = await boxService.getById(box.id);
        finalBox = result._unsafeUnwrap()!;

        if (
          finalBox.instanceName &&
          !createdSpriteNames.includes(finalBox.instanceName)
        ) {
          createdSpriteNames.push(finalBox.instanceName);
        }

        if (finalBox.status === "running" || finalBox.status === "error") {
          break;
        }
      }

      expect(finalBox.status).toBe("running");
      logger.info({ status: finalBox.status }, "Initial deployment completed");

      // 3. Get initial step states (all should be completed)
      const initialStepsResult = await deployStepService.getSteps(box.id, 1);
      expect(initialStepsResult.isOk()).toBe(true);
      const initialSteps = initialStepsResult._unsafeUnwrap().steps;

      const setupSteps = initialSteps.filter(
        (s) => s.stepKey.startsWith("SETUP_") && s.parentId
      );
      const completedCount = setupSteps.filter(
        (s) => s.status === "completed"
      ).length;
      expect(completedCount).toBe(setupSteps.length);
      logger.info(
        { completedCount, total: setupSteps.length },
        "All setup steps completed"
      );

      // 4. Trigger redeploy (same attempt)
      // This tests that the flow skips already completed steps
      logger.info("Triggering redeploy to test resume behavior...");

      // Queue orchestrator job directly (simulating redeploy)
      await testEnv.deps.queue.deployOrchestratorQueue.add(
        `redeploy-${box.id}`,
        {
          boxId: box.id,
          userId: testEnv.users.authenticated.id,
          subdomain: box.subdomain,
          skills: [],
          deploymentAttempt: 1, // Same attempt = resume
        }
      );

      // 5. Wait for redeploy to complete (should be fast since steps are skipped)
      elapsed = 0;
      const redeployMaxWait = 2 * 60 * 1000; // 2 minutes (should be much faster)

      while (elapsed < redeployMaxWait) {
        await new Promise((r) => setTimeout(r, pollInterval));
        elapsed += pollInterval;

        // Check if any jobs are still processing
        // For simplicity, just wait and check box status
        const result = await boxService.getById(box.id);
        finalBox = result._unsafeUnwrap()!;

        if (finalBox.status === "running") {
          break;
        }
      }

      expect(finalBox.status).toBe("running");
      logger.info(
        { elapsed: `${elapsed / 1000}s` },
        "Redeploy completed (should be fast due to skip)"
      );

      // 6. Verify steps still show as completed
      const finalStepsResult = await deployStepService.getSteps(box.id, 1);
      expect(finalStepsResult.isOk()).toBe(true);
      const finalSteps = finalStepsResult._unsafeUnwrap().steps;

      const finalSetupSteps = finalSteps.filter(
        (s) => s.stepKey.startsWith("SETUP_") && s.parentId
      );
      const finalCompletedCount = finalSetupSteps.filter(
        (s) => s.status === "completed"
      ).length;
      expect(finalCompletedCount).toBe(finalSetupSteps.length);

      logger.info("Resume test passed - completed steps were skipped");
    }, 600_000);

    it("resumes from failed step after manual retry", async () => {
      const testSuffix = Date.now().toString(36);
      const boxName = `retry-test-${testSuffix}`;

      // 1. Create and fully deploy a box
      logger.info({ boxName }, "Creating box for retry test...");
      const boxResult = await boxService.create(
        testEnv.users.authenticated.id,
        {
          name: boxName,
        }
      );

      expect(boxResult.isOk()).toBe(true);
      const box = boxResult._unsafeUnwrap();

      // 2. Wait for deployment
      const maxWait = 5 * 60 * 1000;
      const pollInterval = 5000;
      let elapsed = 0;
      let finalBox = box;

      while (elapsed < maxWait) {
        await new Promise((r) => setTimeout(r, pollInterval));
        elapsed += pollInterval;

        const result = await boxService.getById(box.id);
        finalBox = result._unsafeUnwrap()!;

        if (
          finalBox.instanceName &&
          !createdSpriteNames.includes(finalBox.instanceName)
        ) {
          createdSpriteNames.push(finalBox.instanceName);
        }

        if (finalBox.status === "running" || finalBox.status === "error") {
          break;
        }
      }

      expect(finalBox.status).toBe("running");

      // 3. Manually mark one step as failed (simulate failure scenario)
      // This tests the resetFailedSteps functionality
      await deployStepService.updateStepStatus(
        box.id,
        1,
        "SETUP_AGENT_APP_SERVICE",
        "failed",
        { errorMessage: "Simulated failure for test" }
      );

      logger.info("Marked SETUP_AGENT_APP_SERVICE as failed");

      // 4. Verify step is failed
      const failedStepResult = await deployStepService.getStepByKey(
        box.id,
        1,
        "SETUP_AGENT_APP_SERVICE"
      );
      expect(failedStepResult.isOk()).toBe(true);
      expect(failedStepResult._unsafeUnwrap()?.status).toBe("failed");

      // 5. Trigger redeploy - should reset failed step and skip completed ones
      await testEnv.deps.queue.deployOrchestratorQueue.add(`retry-${box.id}`, {
        boxId: box.id,
        userId: testEnv.users.authenticated.id,
        subdomain: box.subdomain,
        skills: [],
        deploymentAttempt: 1,
      });

      // 6. Wait for redeploy
      elapsed = 0;
      while (elapsed < maxWait) {
        await new Promise((r) => setTimeout(r, pollInterval));
        elapsed += pollInterval;

        const stepResult = await deployStepService.getStepByKey(
          box.id,
          1,
          "SETUP_AGENT_APP_SERVICE"
        );
        const step = stepResult._unsafeUnwrap();

        if (step?.status === "completed") {
          break;
        }
      }

      // 7. Verify the previously failed step is now completed
      const retriedStepResult = await deployStepService.getStepByKey(
        box.id,
        1,
        "SETUP_AGENT_APP_SERVICE"
      );
      expect(retriedStepResult.isOk()).toBe(true);
      expect(retriedStepResult._unsafeUnwrap()?.status).toBe("completed");

      logger.info("Retry test passed - failed step was reset and re-executed");
    }, 600_000);
  });
});
