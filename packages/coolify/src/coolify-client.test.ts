import { createLogger } from "@vps-claude/logger";
import { Environment, SERVICE_URLS } from "@vps-claude/shared/services.schema";
import { env } from "bun";
import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { createCoolifyClient } from "./coolify-client";

const logger = createLogger({ appName: "coolify-test" });

const TestEnvSchema = z.object({
  APP_ENV: Environment,
  COOLIFY_API_TOKEN: z.string(),
  COOLIFY_PROJECT_UUID: z.string(),
  COOLIFY_SERVER_UUID: z.string(),
  COOLIFY_ENVIRONMENT_NAME: z.string(),
  COOLIFY_ENVIRONMENT_UUID: z.string(),
});

const testEnv = TestEnvSchema.parse(env);

describe("CoolifyClient", () => {
  const client = createCoolifyClient({
    env: testEnv.APP_ENV,
    apiToken: testEnv.COOLIFY_API_TOKEN,
    projectUuid: testEnv.COOLIFY_PROJECT_UUID,
    serverUuid: testEnv.COOLIFY_SERVER_UUID,
    environmentName: testEnv.COOLIFY_ENVIRONMENT_NAME,
    environmentUuid: testEnv.COOLIFY_ENVIRONMENT_UUID,
    agentsDomain: SERVICE_URLS[testEnv.APP_ENV].agentsDomain,
    logger,
  });

  test(
    "full lifecycle: create -> deploy -> wait -> get",
    async () => {
      const testSubdomain = `test-${Date.now()}`;

      // Create
      const createResult = await client.createApplication({
        subdomain: testSubdomain,
        password: "test-password-123",
        claudeMdContent:
          "# Test Agent\n\nThis is a test agent for integration testing.",
      });
      expect(createResult.isOk()).toBe(true);
      const created = createResult._unsafeUnwrap();
      expect(created.uuid).toBeDefined();
      const uuid = created.uuid;

      // Deploy
      const deployResult = await client.deployApplication(uuid);
      expect(deployResult.isOk()).toBe(true);
      const { deploymentUuid } = deployResult._unsafeUnwrap();

      // Wait for deployment to complete
      const waitResult = await client.waitForDeployment(deploymentUuid, {
        pollIntervalMs: 3000,
        timeoutMs: 300000, // 5 min timeout
      });
      expect(waitResult.isOk()).toBe(true);
      const deployment = waitResult._unsafeUnwrap();
      expect(deployment.status).toBe("finished");

      // Get application
      const getResult = await client.getApplication(uuid);
      expect(getResult.isOk()).toBe(true);
      const app = getResult._unsafeUnwrap();
      expect(app.uuid).toBe(uuid);
      expect(app.name).toBe(testSubdomain);

      // Get deploy logs
      logger.info(
        { deployLogs: deployment.logs?.slice(0, 500) },
        "Deploy logs (first 500 chars)"
      );

      // Wait for container to be healthy (detect crash loops)
      const healthResult = await client.waitForHealthy(uuid, {
        pollIntervalMs: 5000,
        timeoutMs: 120000, // 2 min timeout
      });
      expect(healthResult.isOk()).toBe(true);
      const health = healthResult._unsafeUnwrap();
      // Status can be "running", "running:unknown", "running:healthy"
      expect(health.status.startsWith("running")).toBe(true);

      // Get runtime logs
      const logsResult = await client.getApplicationLogs(uuid, 50);
      if (logsResult.isOk()) {
        logger.info(
          { runtimeLogs: logsResult.value.logs.slice(0, 500) },
          "Runtime logs (first 500 chars)"
        );
      } else {
        logger.warn({ error: logsResult.error }, "Failed to get runtime logs");
      }

      // Cleanup - delete the test application
      const deleteResult = await client.deleteApplication(uuid);
      expect(deleteResult.isOk()).toBe(true);

      logger.info(
        {
          uuid,
          fqdn: created.fqdn,
          status: deployment.status,
          containerStatus: health.status,
        },
        "Test complete - app deleted"
      );
    },
    { timeout: 360000 }
  );
});
