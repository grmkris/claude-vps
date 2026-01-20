#!/usr/bin/env bun
import { signIn, createClient, createAuthHelper } from "../src/index.js";

const TEST_EMAIL = "integration-test@example.com";
const TEST_PASSWORD = "integration-test-123";
const API_URL = process.env.API_URL || "http://api.localhost:33000";

async function createTestBox() {
  console.log("=== Creating Test Box via SDK ===\n");

  // Use special signIn() that captures session cookie
  console.log(`Attempting sign in for ${TEST_EMAIL}...`);
  let result = await signIn(API_URL, TEST_EMAIL, TEST_PASSWORD);

  if (result.error) {
    // Sign up first
    console.log("User doesn't exist, signing up...");
    const auth = createAuthHelper(API_URL);
    const signUp = await auth.signUp.email({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      name: "Integration Test User",
    });

    if (signUp.error) {
      console.error(`✗ Sign up failed: ${signUp.error.message}`);
      process.exit(1);
    }

    console.log("✓ User created");

    // Sign in again to get session cookie
    result = await signIn(API_URL, TEST_EMAIL, TEST_PASSWORD);
    if (result.error) {
      console.error(`✗ Sign in failed: ${result.error}`);
      process.exit(1);
    }
  }

  if (!result.sessionCookie) {
    console.error("✗ No session cookie returned");
    process.exit(1);
  }

  console.log("✓ Authenticated successfully\n");

  // Create authenticated auth helper (unused but kept for reference)
  const _auth = createAuthHelper(API_URL, result.sessionCookie);

  // Create API key using ORPC client
  console.log("Creating API key...");
  const client = createClient({
    baseUrl: API_URL,
    sessionToken: result.sessionCookie,
  });

  let apiKeyResult;
  try {
    const keyData = await client.apiKey.create({
      name: `integration-test-${Date.now()}`,
      permissions: {
        box: ["create", "read", "delete", "deploy"],
        secret: ["read"],
        skill: ["read"],
      },
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
    console.error(`✗ API key creation failed: ${apiKeyResult.error}`);
    process.exit(1);
  }

  console.log("✓ API key created\n");

  // Create client with API key
  const apiKeyClient = createClient({
    baseUrl: API_URL,
    apiKey: apiKeyResult.key,
  });

  // Create box
  console.log("Creating box...");
  const boxName = `test-int-${Date.now()}`;

  try {
    const result = await apiKeyClient.box.create({
      name: boxName,
      password: "test123456",
      skills: [],
    });

    const box = result.box;

    console.log(`✓ Box created successfully!`);
    console.log(`\nBox Details:`);
    console.log(`  Name: ${box.name}`);
    console.log(`  Subdomain: ${box.subdomain}`);
    console.log(`  Status: ${box.status}`);
    console.log(`\nAccess URLs:`);
    console.log(`  HTTP: http://${box.subdomain}.agents.localhost:8090`);
    console.log(
      `  SSH: ssh coder@ssh.localhost -p 2222 (password: test123456)`
    );
    console.log(`\nExport for tests:`);
    console.log(`export TEST_BOX_SUBDOMAIN=${box.subdomain}`);

    return box;
  } catch (error) {
    console.error(`✗ Box creation failed:`);
    console.error(JSON.stringify(error, null, 2));
    process.exit(1);
  }
}

createTestBox().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
