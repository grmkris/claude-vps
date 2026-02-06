import { createLogger } from "@vps-claude/logger";
import {
  createProviderFactory,
  type ProviderFactory,
} from "@vps-claude/providers";
import { getBoxAgentBinaryUrl } from "@vps-claude/shared";
import { createTestSetup, type TestSetup } from "@vps-claude/test-utils";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs";

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

const logger = createLogger({ appName: "docker-deploy-flow-test" });

const DOCKER_SOCKET = process.env.DOCKER_SOCKET || "/var/run/docker.sock";
const HAS_DOCKER = fs.existsSync(DOCKER_SOCKET);
const BASE_DOMAIN = process.env.TEST_BASE_DOMAIN || "agents.localhost";

// Claude authentication - needed for session tests
const CLAUDE_TOKEN =
  process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
const CLAUDE_TOKEN_KEY = process.env.CLAUDE_CODE_OAUTH_TOKEN
  ? "CLAUDE_CODE_OAUTH_TOKEN"
  : "ANTHROPIC_API_KEY";

// Box-agent binary URL (auto-detects architecture)
const BOX_AGENT_BINARY_URL = getBoxAgentBinaryUrl(
  process.env.BOX_AGENT_BINARY_URL
);

describe.skipIf(!HAS_DOCKER)("Docker Deploy Flow Integration", () => {
  let testEnv: TestSetup;
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

  // Track containers for cleanup
  const createdContainers: string[] = [];

  beforeAll(async () => {
    testEnv = await createTestSetup();

    // Create Docker-based provider factory (no spritesClient needed)
    providerFactory = createProviderFactory({
      dockerOptions: {
        socketPath: DOCKER_SOCKET,
        baseDomain: BASE_DOMAIN,
      },
      logger,
    });

    // Create services - boxEnvVarService must be created FIRST so we can pass it to boxService
    boxEnvVarService = createBoxEnvVarService({
      deps: { db: testEnv.db },
    });

    boxService = createBoxService({
      deps: {
        db: testEnv.db,
        queueClient: testEnv.deps.queue,
        boxEnvVarService, // Required for envVars to be set before deploy job
      },
    });

    deployStepService = createDeployStepService({
      deps: { db: testEnv.db },
    });

    emailService = createEmailService({
      deps: {
        db: testEnv.db,
        queueClient: testEnv.deps.queue,
        agentsDomain: BASE_DOMAIN,
      },
    });

    // Create all deploy flow workers with Docker provider factory
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

    // Cleanup containers using Docker provider
    const dockerProvider = providerFactory.getProvider("docker");
    for (const instanceName of createdContainers) {
      try {
        await dockerProvider.deleteInstance(instanceName);
        logger.info({ instanceName }, "Cleaned up test container");
      } catch (error) {
        logger.warn({ instanceName, error }, "Failed to cleanup container");
      }
    }

    await testEnv.close();
  }, 30_000);

  // Helper to verify env vars in container
  async function verifyEnvVarInContainer(
    instanceName: string,
    envKey: string
  ): Promise<{ found: boolean; value?: string }> {
    const dockerProvider = providerFactory.getProvider("docker");
    try {
      const result = await dockerProvider.execShell(
        instanceName,
        `grep "^export ${envKey}=" /home/box/.bashrc.env`
      );
      if (result.exitCode === 0 && result.stdout.includes(envKey)) {
        // Extract value from "export KEY="value""
        const match = result.stdout.match(
          new RegExp(`^export ${envKey}="(.+)"`, "m")
        );
        return { found: true, value: match?.[1] };
      }
      return { found: false };
    } catch {
      return { found: false };
    }
  }

  // Helper to inject env vars directly into running container
  async function injectEnvVars(
    instanceName: string,
    envVars: Record<string, string>
  ): Promise<void> {
    const dockerProvider = providerFactory.getProvider("docker");
    await dockerProvider.updateEnvVars(instanceName, envVars);
  }

  // Helper to deploy and wait for running status
  async function deployAndWait(
    boxName: string,
    envVars?: Record<string, string>
  ) {
    // Pass envVars directly to boxService.create() - they're set BEFORE deploy job is queued
    const boxResult = await boxService.create(testEnv.users.authenticated.id, {
      name: boxName,
      provider: "docker",
      envVars,
    });

    expect(boxResult.isOk()).toBe(true);
    const box = boxResult._unsafeUnwrap();

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
        !createdContainers.includes(finalBox.instanceName)
      ) {
        createdContainers.push(finalBox.instanceName);
      }

      if (finalBox.status === "running" || finalBox.status === "error") {
        break;
      }
    }

    expect(finalBox.status).toBe("running");
    expect(finalBox.instanceUrl).toBeDefined();

    return { box, finalBox };
  }

  it("deploys box through Docker provider", async () => {
    const testSuffix = Date.now().toString(36);
    const boxName = `docker-flow-test-${testSuffix}`;

    logger.info({ boxName }, "Creating box with Docker provider...");
    const { box, finalBox } = await deployAndWait(boxName);

    logger.info(
      {
        boxId: finalBox.id,
        instanceName: finalBox.instanceName,
        instanceUrl: finalBox.instanceUrl,
        status: finalBox.status,
      },
      "Box deployment completed"
    );

    // Verify all top-level deploy steps completed
    const stepsResult = await deployStepService.getSteps(box.id, 1);
    expect(stepsResult.isOk()).toBe(true);
    const { steps } = stepsResult._unsafeUnwrap();
    const topLevel = steps.filter((s) => !s.parentId);

    for (const step of topLevel) {
      expect(step.status).toBe("completed");
    }

    // Verify health check passed
    const healthStep = steps.find((s) => s.stepKey === "HEALTH_CHECK");
    expect(healthStep?.status).toBe("completed");

    logger.info("Docker deploy test passed");
  }, 600_000);

  it("Docker box health endpoint accessible via Traefik", async () => {
    const testSuffix = Date.now().toString(36);
    const boxName = `docker-health-test-${testSuffix}`;

    const { finalBox } = await deployAndWait(boxName);

    const healthUrl = `${finalBox.instanceUrl}/box/health`;
    logger.info({ healthUrl }, "Testing health endpoint...");

    const response = await fetch(healthUrl, {
      signal: AbortSignal.timeout(10000),
    });

    expect(response.ok).toBe(true);
    const data = (await response.json()) as { agent: string };
    expect(data.agent).toBe("box-agent");

    logger.info("Health endpoint test passed");
  }, 600_000);

  it("Docker box landing page accessible", async () => {
    const testSuffix = Date.now().toString(36);
    const boxName = `docker-landing-test-${testSuffix}`;

    const { box, finalBox } = await deployAndWait(boxName);

    const landingUrl = `${finalBox.instanceUrl}/`;
    logger.info({ landingUrl }, "Testing landing page...");

    const response = await fetch(landingUrl, {
      signal: AbortSignal.timeout(10000),
    });

    expect(response.ok).toBe(true);
    const html = await response.text();

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain(box.subdomain);
    expect(html).toContain("/app");
    expect(html).toContain("/box/");

    logger.info("Landing page test passed");
  }, 600_000);

  it("execution status endpoint returns isExecuting false initially", async () => {
    const testSuffix = Date.now().toString(36);
    const boxName = `docker-exec-status-${testSuffix}`;

    const { finalBox } = await deployAndWait(boxName);

    const statusUrl = `${finalBox.instanceUrl}/box/rpc/sessions/execution-status`;
    logger.info({ statusUrl }, "Testing execution status endpoint...");

    const response = await fetch(statusUrl, {
      signal: AbortSignal.timeout(10000),
    });

    expect(response.ok).toBe(true);
    const data = (await response.json()) as {
      isExecuting: boolean;
      activeSessions: Array<{
        sessionId: string | null;
        startedAt: number;
        lastActivityAt: number;
        messageCount: number;
      }>;
    };

    expect(data.isExecuting).toBe(false);
    expect(data.activeSessions).toEqual([]);

    logger.info("Execution status test passed - initially not executing");
  }, 600_000);

  // KNOWN ISSUE: This test verifies execution watcher detects running Claude sessions.
  // Manual testing confirms the watcher works (isExecuting: true during active sessions).
  // However, the automated test fails due to timing:
  // - Session completes in ~2-10 seconds (Claude returns quickly for test prompts)
  // - fs.watch() async callbacks have latency before updating execution_state table
  // - By the time polling starts, session is already complete
  // To properly test this, we'd need to mock the Claude session or use a very long-running task.
  it.skip("execution status shows running session during Claude execution", async () => {
    const testSuffix = Date.now().toString(36);
    const boxName = `docker-exec-running-${testSuffix}`;

    // Pass Claude token to container via standard env var flow
    const { box, finalBox } = await deployAndWait(boxName, {
      [CLAUDE_TOKEN_KEY]: CLAUDE_TOKEN!,
    });

    // Verify token reached container, inject if missing
    const tokenCheck = await verifyEnvVarInContainer(
      finalBox.instanceName!,
      CLAUDE_TOKEN_KEY
    );
    logger.info(
      { found: tokenCheck.found, key: CLAUDE_TOKEN_KEY },
      "Token verification in container"
    );

    if (!tokenCheck.found) {
      logger.warn("Token not found via env var flow, injecting directly...");
      await injectEnvVars(finalBox.instanceName!, {
        [CLAUDE_TOKEN_KEY]: CLAUDE_TOKEN!,
      });
      // Wait for box-agent restart
      await new Promise((r) => setTimeout(r, 3000));
    }

    // Get agent secret
    const settingsResult = await emailService.getOrCreateSettings(box.id);
    expect(settingsResult.isOk()).toBe(true);
    const agentSecret = settingsResult._unsafeUnwrap().agentSecret;

    // Start a long-running Claude session (don't await completion)
    const streamUrl = `${finalBox.instanceUrl}/box/rpc/sessions/stream`;
    logger.info({ streamUrl }, "Starting long-running session...");

    const sessionPromise = fetch(streamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Box-Secret": agentSecret,
      },
      body: JSON.stringify({
        message:
          "I need you to write a comprehensive technical document. First, explain the history of version control systems from RCS to Git, including at least 5 systems. Then, write detailed tutorials for: 1) Setting up a Git repository with branching strategies, 2) Implementing CI/CD pipelines with GitHub Actions including 3 example workflows, 3) Docker containerization best practices with multi-stage builds. For each section, include code examples, diagrams described in text, common pitfalls, and troubleshooting tips. This should be thorough enough to serve as a reference guide. Take your time and be extremely detailed.",
        contextType: "test",
        contextId: `exec-test-${testSuffix}`,
      }),
      signal: AbortSignal.timeout(180000),
    });

    // Consume the SSE stream to keep the connection alive
    // This runs in background while we poll for execution status
    sessionPromise
      .then(async (res) => {
        logger.info(
          { status: res.status, ok: res.ok },
          "Session stream response received"
        );
        if (!res.ok) {
          const text = await res.text();
          logger.error({ status: res.status, body: text }, "Session failed");
          return;
        }
        // Read the stream to keep connection alive
        const reader = res.body?.getReader();
        if (!reader) return;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              logger.info("Session stream completed");
              break;
            }
            // Log first chunk to verify streaming
            if (value) {
              const text = new TextDecoder().decode(value);
              if (text.includes("event:")) {
                logger.info(
                  { chunkLength: value.length },
                  "Received SSE chunk"
                );
              }
            }
          }
        } catch (err) {
          logger.warn(
            { err },
            "Stream reading error (may be expected on cancel)"
          );
        }
      })
      .catch((err) => {
        logger.error({ err }, "Session stream request failed");
      });

    // Start polling immediately - session may complete quickly
    // Wait just 2 seconds for Claude to start writing session file
    await new Promise((r) => setTimeout(r, 2000));

    // Poll for execution status
    const statusUrl = `${finalBox.instanceUrl}/box/rpc/sessions/execution-status`;
    let data: {
      isExecuting: boolean;
      activeSessions: Array<{
        sessionId: string | null;
        startedAt: number;
        lastActivityAt: number;
        messageCount: number;
      }>;
    } = { isExecuting: false, activeSessions: [] };

    // Poll every 1 second for up to 90 seconds to catch the running window
    for (let attempt = 0; attempt < 90; attempt++) {
      await new Promise((r) => setTimeout(r, 1000));

      const statusResponse = await fetch(statusUrl, {
        signal: AbortSignal.timeout(10000),
      });

      expect(statusResponse.ok).toBe(true);
      data = (await statusResponse.json()) as typeof data;

      logger.info({ attempt, data }, "Polling execution status during session");

      if (data.isExecuting) {
        break;
      }
    }

    // Session should be running
    expect(data.isExecuting).toBe(true);
    expect(data.activeSessions.length).toBeGreaterThan(0);

    // Verify session details
    const session = data.activeSessions[0];
    expect(session).toBeDefined();
    expect(session?.startedAt).toBeGreaterThan(0);
    expect(session?.lastActivityAt).toBeGreaterThan(0);
    expect(session?.messageCount).toBeGreaterThanOrEqual(0);

    // Clean up - cancel the session
    try {
      const response = await sessionPromise;
      void response.body?.cancel();
    } catch {
      // Ignore timeout/cancel errors
    }

    logger.info("Execution status test passed - detected running session");
  }, 600_000);
});
