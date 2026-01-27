#!/usr/bin/env bun
import { createLogger } from "@vps-claude/logger";

import { signIn, createClient, createAuthHelper } from "../src/index.js";

const logger = createLogger({ appName: "sdk-test" });

const TEST_EMAIL = "integration-test@example.com";
const TEST_PASSWORD = "integration-test-123";
const API_URL = process.env.API_URL || "http://api.localhost:33000";

async function createTestBox() {
  logger.info("=== Creating Test Box via SDK ===");

  // Use special signIn() that captures session cookie
  logger.info({ email: TEST_EMAIL }, "Attempting sign in");
  let result = await signIn(API_URL, TEST_EMAIL, TEST_PASSWORD);

  if (result.error) {
    // Sign up first
    logger.info("User doesn't exist, signing up...");
    const auth = createAuthHelper(API_URL);
    const signUp = await auth.signUp.email({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      name: "Integration Test User",
    });

    if (signUp.error) {
      logger.error({ error: signUp.error.message }, "Sign up failed");
      process.exit(1);
    }

    logger.info("User created");

    // Sign in again to get session cookie
    result = await signIn(API_URL, TEST_EMAIL, TEST_PASSWORD);
    if (result.error) {
      logger.error({ error: result.error }, "Sign in failed");
      process.exit(1);
    }
  }

  if (!result.sessionCookie) {
    logger.error("No session cookie returned");
    process.exit(1);
  }

  logger.info("Authenticated successfully");

  // Create API key using ORPC client
  logger.info("Creating API key...");
  const client = createClient({
    baseUrl: API_URL,
    sessionToken: result.sessionCookie,
  });

  let apiKeyResult;
  try {
    const keyData = await client.apiKey.create({
      name: `integration-test-${Date.now()}`,
      permissions: [
        "box:create",
        "box:read",
        "box:delete",
        "box:deploy",
        "secret:read",
        "skill:read",
      ],
    });
    apiKeyResult = {
      key: keyData.key,
      id: keyData.id,
      error: null,
    };
  } catch (error) {
    apiKeyResult = {
      key: null,
      id: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (apiKeyResult.error || !apiKeyResult.key) {
    logger.error({ error: apiKeyResult.error }, "API key creation failed");
    process.exit(1);
  }

  logger.info("API key created");

  // Create client with API key
  const apiKeyClient = createClient({
    baseUrl: API_URL,
    apiKey: apiKeyResult.key,
  });

  // Create box
  logger.info("Creating box...");
  const boxName = `test-int-${Date.now()}`;

  try {
    const result = await apiKeyClient.box.create({
      name: boxName,
      skills: [],
    });

    const box = result.box;

    logger.info(
      { name: box.name, subdomain: box.subdomain, status: box.status },
      "Box created successfully"
    );
    logger.info(
      { http: `http://${box.subdomain}.agents.localhost:8090` },
      "Access URLs"
    );
    logger.info(`export TEST_BOX_SUBDOMAIN=${box.subdomain}`);

    return box;
  } catch (error) {
    logger.error(
      { error: JSON.stringify(error, null, 2) },
      "Box creation failed"
    );
    process.exit(1);
  }
}

createTestBox().catch((error) => {
  logger.error({ error }, "Fatal error");
  process.exit(1);
});
