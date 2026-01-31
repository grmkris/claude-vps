/**
 * API E2E Test - SDK Only
 *
 * True E2E test that works against any environment (dev/staging/prod).
 * Uses only the SDK - no direct database access. Self-contained - creates own test user.
 *
 * Tests the complete flow:
 * 1. Create test user via SDK
 * 2. Create box via SDK (with optional Claude token for sessions)
 * 3. Wait for deployment
 * 4. Send real email via inboundemail
 * 5. Verify email delivered and Claude session created via SDK
 *
 * Prerequisites:
 * - Server running (local dev or remote)
 * - inboundemail API key for sending test emails
 * - Ngrok or public URL for server (for email webhooks)
 * - CLAUDE_CODE_OAUTH_TOKEN for Claude session spawning (optional)
 *
 * Run:
 *   SERVER_URL=http://localhost:33000 \
 *   INBOUND_API_KEY=xxx AGENTS_DOMAIN=yoda.fun \
 *   CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-... \
 *     bun test tests/e2e/api-e2e.test.ts
 */

import {
  createAuthHelper,
  createClient,
  signIn,
  type AppRouterClient,
} from "@vps-claude/sdk";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Inbound } from "inboundemail";

// Environment configuration
const SERVER_URL = process.env.SERVER_URL || "http://localhost:33000";
const INBOUND_API_KEY = process.env.INBOUND_API_KEY;
const AGENTS_DOMAIN = process.env.AGENTS_DOMAIN || "inbnd.dev";
const CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN;

// Generate unique test user credentials
const testId = Date.now().toString(36);
const TEST_EMAIL = `e2e-test-${testId}@test.local`;
const TEST_PASSWORD = "TestPassword123!";
const TEST_NAME = `E2E Test User ${testId}`;

// Skip test if required env vars missing
const SKIP_TEST = !INBOUND_API_KEY;

if (SKIP_TEST) {
  console.warn("\n⚠️  Skipping API E2E test - missing env vars:");
  if (!INBOUND_API_KEY) console.warn("   - INBOUND_API_KEY");
  console.warn("\nSet env vars and ensure server is running.\n");
}

/**
 * Wait for a condition with polling
 */
async function waitFor<T>(
  fn: () => Promise<T>,
  options: {
    timeoutMs: number;
    pollIntervalMs: number;
    description: string;
    until?: (result: T) => boolean;
  }
): Promise<T> {
  const startTime = Date.now();
  let lastResult: T | undefined;

  while (Date.now() - startTime < options.timeoutMs) {
    lastResult = await fn();
    if (options.until ? options.until(lastResult) : lastResult) {
      return lastResult;
    }
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`Waiting for ${options.description}... ${elapsed}s elapsed`);
    await new Promise((r) => setTimeout(r, options.pollIntervalMs));
  }

  throw new Error(
    `Timeout waiting for ${options.description} after ${options.timeoutMs}ms`
  );
}

describe.skipIf(SKIP_TEST)("API E2E - Email Flow", () => {
  let client: AppRouterClient;
  let inbound: Inbound;
  let boxId: `box_${string}`;
  let subdomain: string;

  beforeAll(async () => {
    console.log("\n=== API E2E Test Setup ===");
    console.log(`Server URL: ${SERVER_URL}`);
    console.log(`Agents Domain: ${AGENTS_DOMAIN}`);

    // 1. Create auth helper and sign up new user
    const authHelper = createAuthHelper(SERVER_URL);
    console.log(`Creating test user: ${TEST_EMAIL}`);

    const signUpResult = await authHelper.signUp.email({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      name: TEST_NAME,
    });

    if (signUpResult.error) {
      throw new Error(`Signup failed: ${signUpResult.error.message}`);
    }
    console.log("Test user created successfully");

    // 2. Sign in to get session cookie
    const { sessionCookie, error: authError } = await signIn(
      SERVER_URL,
      TEST_EMAIL,
      TEST_PASSWORD
    );

    if (authError || !sessionCookie) {
      throw new Error(`Authentication failed: ${authError}`);
    }
    console.log("Authenticated successfully");

    // 3. Create SDK client (uses sessionCookie for auth)
    client = createClient({ baseUrl: SERVER_URL, sessionToken: sessionCookie });
    console.log("SDK client created");

    // 4. Create inboundemail client for sending test emails
    inbound = new Inbound(INBOUND_API_KEY!);
    console.log("Inbound email client created");

    // 5. Create box via SDK
    console.log("Creating box via SDK...");
    const { box } = await client.box.create({
      name: `E2E Test Box ${Date.now().toString(36)}`,
      ...(CLAUDE_CODE_OAUTH_TOKEN && {
        envVars: { CLAUDE_CODE_OAUTH_TOKEN },
      }),
    });
    boxId = box.id;
    subdomain = box.subdomain;
    console.log(`Box created: ${boxId}, subdomain: ${subdomain}`);

    // 6. Wait for box deployment via SDK (poll box status)
    console.log("Waiting for box deployment...");
    const { box: deployedBox } = await waitFor(
      async () => {
        const result = await client.boxDetails.byId({ id: boxId });
        console.log(`Box status: ${result.box.status}`);
        return result;
      },
      {
        timeoutMs: 5 * 60 * 1000, // 5 minutes
        pollIntervalMs: 5000,
        description: "box deployment",
        until: (result) =>
          result.box.status === "running" || result.box.status === "error",
      }
    );

    if (deployedBox.status !== "running") {
      throw new Error(`Box deployment failed: status=${deployedBox.status}`);
    }
    console.log("Box is running");

    console.log("\n=== Setup Complete ===\n");
  }, 600_000); // 10 minute timeout for setup

  afterAll(async () => {
    console.log("\n=== Cleanup ===");

    // Delete box via SDK (cascades cleanup)
    if (boxId && client) {
      try {
        await client.box.delete({ id: boxId });
        console.log("Deleted box via SDK");
      } catch (e) {
        console.warn("Failed to delete box:", e);
      }
    }

    console.log("=== Cleanup Complete ===\n");
  }, 30_000);

  test("Email triggers Claude session", async () => {
    console.log("\n=== Test: Email triggers Claude session ===");

    // Send real email via inboundemail
    const toAddress = `${subdomain}@${AGENTS_DOMAIN}`;
    console.log(`Sending email to ${toAddress}...`);

    const result = await inbound.emails.send({
      from: `e2e-test@${AGENTS_DOMAIN}`,
      to: toAddress,
      subject: `E2E Test ${Date.now()}`,
      text: "This is an automated E2E test. Please respond with a brief acknowledgment.",
    });

    if (!result?.id) {
      throw new Error("Failed to send email: no ID returned");
    }
    console.log(`Email sent successfully: ${result.id}`);

    // Wait for email to be delivered
    console.log("Waiting for email delivery...");
    const { emails } = await waitFor(
      () => client.boxDetails.emails({ id: boxId }),
      {
        timeoutMs: 120_000, // 2 minutes
        pollIntervalMs: 5000,
        description: "email delivery",
        until: (result) => result.emails.some((e) => e.status === "delivered"),
      }
    );

    const deliveredEmail = emails.find((e) => e.status === "delivered");
    expect(deliveredEmail).toBeDefined();
    console.log(`Email delivered: ${deliveredEmail?.id}`);

    // Wait for Claude session to be created
    console.log("Waiting for Claude session...");
    const { sessions } = await waitFor(
      () => client.boxDetails.sessions({ id: boxId }),
      {
        timeoutMs: 180_000, // 3 minutes
        pollIntervalMs: 5000,
        description: "Claude session",
        until: (result) => result.sessions.length > 0,
      }
    );

    expect(sessions.length).toBeGreaterThan(0);
    console.log(`Claude session created: ${sessions[0]?.sessionId}`);

    console.log("\n=== Test Passed ===");
  }, 300_000); // 5 minute timeout for test
});
