import { Environment } from "@vps-claude/shared/services.schema";
import { env } from "bun";
import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { createCoolifyClient } from "./coolify-client";

const TestEnvSchema = z.object({
  APP_ENV: Environment,
  COOLIFY_API_TOKEN: z.string(),
  COOLIFY_PROJECT_UUID: z.string(),
  COOLIFY_SERVER_UUID: z.string(),
  COOLIFY_ENVIRONMENT_NAME: z.string(),
  COOLIFY_ENVIRONMENT_UUID: z.string(),
  AGENTS_DOMAIN: z.string(),
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
    agentsDomain: testEnv.AGENTS_DOMAIN,
  });

  test("full lifecycle: create -> get -> delete", async () => {
    const testSubdomain = `test-${Date.now()}`;

    // Create
    console.log("Creating application...");
    const created = await client.createApplication({
      subdomain: testSubdomain,
      password: "test-password-123",
      claudeMdContent: "# Test Agent\n\nThis is a test agent for integration testing.",
    });
    console.log("Created:", created);
    expect(created.uuid).toBeDefined();
    if (!created.uuid) throw new Error("No UUID returned");
    const uuid = created.uuid;

    // Get
    console.log("Getting application...");
    const app = await client.getApplication(uuid);
    console.log("Got:", app);
    expect(app.uuid).toBe(uuid);
    expect(app.name).toBe(testSubdomain);

    // Delete
    console.log("Deleting application...");
    await client.deleteApplication(uuid);
    console.log("Deleted");
  });
});
