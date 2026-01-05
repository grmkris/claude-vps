import { createCoolifyClient } from "@vps-claude/coolify";
import { createLogger } from "@vps-claude/logger";
import { Environment } from "@vps-claude/shared/services.schema";
import { createTestSetup, type TestSetup } from "@vps-claude/test-utils";
import { env } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { z } from "zod";

import { createBoxService, type BoxService } from "../services/box.service";
import { createEmailService } from "../services/email.service";
import { createSecretService } from "../services/secret.service";
import { createSkillService } from "../services/skill.service";
import { createDeployWorker, createDeleteWorker } from "./deploy-box.worker";

const TestEnvSchema = z.object({
  APP_ENV: Environment.default("dev"),
  COOLIFY_API_TOKEN: z.string(),
  COOLIFY_PROJECT_UUID: z.string(),
  COOLIFY_SERVER_UUID: z.string(),
  COOLIFY_ENVIRONMENT_NAME: z.string(),
  COOLIFY_ENVIRONMENT_UUID: z.string(),
  AGENTS_DOMAIN: z.string(),
});

const testEnvVars = TestEnvSchema.parse(env);

describe("Deploy Worker E2E", () => {
  let testEnv: TestSetup;
  let boxService: BoxService;
  let coolifyClient: ReturnType<typeof createCoolifyClient>;
  let deployWorker: ReturnType<typeof createDeployWorker>;
  let deleteWorker: ReturnType<typeof createDeleteWorker>;

  beforeAll(async () => {
    testEnv = await createTestSetup();
    const logger = createLogger({ appName: "deploy-test" });

    coolifyClient = createCoolifyClient({
      env: testEnvVars.APP_ENV,
      apiToken: testEnvVars.COOLIFY_API_TOKEN,
      projectUuid: testEnvVars.COOLIFY_PROJECT_UUID,
      serverUuid: testEnvVars.COOLIFY_SERVER_UUID,
      environmentName: testEnvVars.COOLIFY_ENVIRONMENT_NAME,
      environmentUuid: testEnvVars.COOLIFY_ENVIRONMENT_UUID,
      agentsDomain: testEnvVars.AGENTS_DOMAIN,
      logger,
    });

    boxService = createBoxService({
      deps: { db: testEnv.db, queueClient: testEnv.deps.queue },
    });

    const emailService = createEmailService({
      deps: { db: testEnv.db, queueClient: testEnv.deps.queue },
    });
    const secretService = createSecretService({ deps: { db: testEnv.db } });
    const skillService = createSkillService({ deps: { db: testEnv.db } });

    deployWorker = createDeployWorker({
      deps: {
        boxService,
        emailService,
        secretService,
        skillService,
        coolifyClient,
        redis: testEnv.deps.redis,
        logger,
        serverUrl: "http://localhost:33000",
      },
    });

    deleteWorker = createDeleteWorker({
      deps: {
        boxService,
        coolifyClient,
        redis: testEnv.deps.redis,
        logger,
      },
    });
  });

  afterAll(async () => {
    await deployWorker.close();
    await deleteWorker.close();
    await testEnv.close();
  });

  test("deploys box via worker and reaches running state", async () => {
    // 1. Create box
    const createResult = await boxService.create(
      testEnv.users.authenticated.id,
      { name: `e2e-test-${Date.now()}`, password: "testpass123" }
    );
    expect(createResult.isOk()).toBe(true);
    const box = createResult._unsafeUnwrap();

    // 2. Deploy (queues job to real Redis)
    const deployResult = await boxService.deploy(
      box.id,
      testEnv.users.authenticated.id,
      "testpass123"
    );
    expect(deployResult.isOk()).toBe(true);

    // 3. Poll for worker to finish (max 5 min for Docker build)
    const maxWait = 300_000;
    const pollInterval = 5_000;
    let elapsed = 0;
    let finalStatus: string | undefined;

    while (elapsed < maxWait) {
      const updated = await boxService.getById(box.id);
      finalStatus = updated?.status;

      if (finalStatus === "running" || finalStatus === "error") {
        break;
      }

      await new Promise((r) => setTimeout(r, pollInterval));
      elapsed += pollInterval;
    }

    // 4. Verify success
    const finalBox = await boxService.getById(box.id);
    if (finalStatus === "error" && finalBox?.coolifyApplicationUuid) {
      console.error("Deployment failed:", finalBox?.errorMessage);
      // Try to get container logs
      const logsResult = await coolifyClient.getApplicationLogs(
        finalBox.coolifyApplicationUuid,
        100
      );
      if (logsResult.isOk()) {
        console.error("Container logs:", logsResult.value.logs);
      }
    }
    expect(finalStatus).toBe("running");

    // 5. Cleanup - delete from Coolify
    const boxRecord = await boxService.getById(box.id);
    if (boxRecord?.coolifyApplicationUuid) {
      await coolifyClient.deleteApplication(boxRecord.coolifyApplicationUuid);
    }
  }, 360_000); // 6 min timeout
});
