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

import { createLogger } from "@vps-claude/logger";
import {
  createAuthHelper,
  createClient,
  signIn,
  type AppRouterClient,
} from "@vps-claude/sdk";
import { env } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Inbound } from "inboundemail";
import { z } from "zod";

const logger = createLogger({ appName: "e2e-test", level: "info" });

const TestEnvSchema = z.object({
  SERVER_URL: z.string().url(),
  INBOUND_API_KEY: z.string().min(1),
  AGENTS_DOMAIN: z.string().min(1),
  CLAUDE_CODE_OAUTH_TOKEN: z.string().min(1),
});
// Environment configuration
const TEST_ENV = TestEnvSchema.parse(env);

// Generate unique test user credentials
const testId = Date.now().toString(36);
const TEST_EMAIL = `e2e-test-${testId}@test.local`;
const TEST_PASSWORD = "TestPassword123!";
const TEST_NAME = `E2E Test User ${testId}`;

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
    logger.info(
      { description: options.description, elapsedSec: elapsed },
      "Waiting..."
    );
    await new Promise((r) => setTimeout(r, options.pollIntervalMs));
  }

  throw new Error(
    `Timeout waiting for ${options.description} after ${options.timeoutMs}ms`
  );
}

describe("API E2E - Email Flow", () => {
  let client: AppRouterClient;
  let inbound: Inbound;
  let boxId: `box_${string}`;
  let subdomain: string;

  beforeAll(async () => {
    logger.info("=== API E2E Test Setup ===");
    logger.info(
      { serverUrl: TEST_ENV.SERVER_URL, agentsDomain: TEST_ENV.AGENTS_DOMAIN },
      "Config"
    );

    // 1. Create auth helper and sign up new user
    const authHelper = createAuthHelper(TEST_ENV.SERVER_URL);
    logger.info({ email: TEST_EMAIL }, "Creating test user");

    const signUpResult = await authHelper.signUp.email({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      name: TEST_NAME,
    });

    if (signUpResult.error) {
      throw new Error(`Signup failed: ${signUpResult.error.message}`);
    }
    logger.info("Test user created successfully");

    // 2. Sign in to get session cookie
    const { sessionCookie, error: authError } = await signIn(
      TEST_ENV.SERVER_URL,
      TEST_EMAIL,
      TEST_PASSWORD
    );

    if (authError || !sessionCookie) {
      throw new Error(`Authentication failed: ${authError}`);
    }
    logger.info("Authenticated successfully");

    // 3. Create SDK client (uses sessionCookie for auth)
    client = createClient({
      baseUrl: TEST_ENV.SERVER_URL,
      sessionToken: sessionCookie,
    });
    logger.info("SDK client created");

    // 4. Create inboundemail client for sending test emails
    inbound = new Inbound({
      apiKey: TEST_ENV.INBOUND_API_KEY,
    });
    logger.info("Inbound email client created");

    // 5. Create box via SDK
    logger.info("Creating box via SDK...");
    const { box } = await client.box.create({
      name: `E2E Test Box ${Date.now().toString(36)}`,
      ...(TEST_ENV.CLAUDE_CODE_OAUTH_TOKEN && {
        envVars: { CLAUDE_CODE_OAUTH_TOKEN: TEST_ENV.CLAUDE_CODE_OAUTH_TOKEN },
      }),
    });
    boxId = box.id;
    subdomain = box.subdomain;
    logger.info({ boxId, subdomain }, "Box created");

    // 6. Wait for box deployment via SDK (poll box status)
    logger.info("Waiting for box deployment...");
    const { box: deployedBox } = await waitFor(
      async () => {
        const result = await client.boxDetails.byId({ id: boxId });
        logger.info({ status: result.box.status }, "Box status");
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
    logger.info("Box is running");

    logger.info("=== Setup Complete ===");
  }, 600_000); // 10 minute timeout for setup

  afterAll(async () => {
    logger.info("=== Cleanup ===");

    // Delete box via SDK (cascades cleanup)
    if (boxId && client) {
      try {
        await client.box.delete({ id: boxId });
        logger.info("Deleted box via SDK");
      } catch (e) {
        logger.warn({ error: e }, "Failed to delete box");
      }
    }

    logger.info("=== Cleanup Complete ===");
  }, 30_000);

  test("Email triggers Claude session", async () => {
    logger.info("=== Test: Email triggers Claude session ===");

    // Send real email via inboundemail
    const toAddress = `${subdomain}@${TEST_ENV.AGENTS_DOMAIN}`;
    logger.info({ toAddress }, "Sending email");

    const result = await inbound.emails.send({
      from: `e2e-test@${TEST_ENV.AGENTS_DOMAIN}`,
      to: toAddress,
      subject: `E2E Test ${Date.now()}`,
      text: "This is an automated E2E test. Please respond with a brief acknowledgment.",
    });

    if (!result?.id) {
      throw new Error("Failed to send email: no ID returned");
    }
    logger.info({ emailId: result.id }, "Email sent successfully");

    // Wait for email to be delivered
    logger.info("Waiting for email delivery...");
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
    logger.info({ emailId: deliveredEmail?.id }, "Email delivered");

    // Wait for Claude session to be created
    logger.info("Waiting for Claude session...");
    const { sessions } = await waitFor(
      () => client.boxSessions.list({ id: boxId }),
      {
        timeoutMs: 180_000, // 3 minutes
        pollIntervalMs: 5000,
        description: "Claude session",
        until: (result: { sessions: Array<{ sessionId: string }> }) =>
          result.sessions.length > 0,
      }
    );

    expect(sessions.length).toBeGreaterThan(0);
    const sessionId = sessions[0]?.sessionId;
    expect(sessionId).toBeDefined();
    logger.info({ sessionId }, "Claude session created");

    // Wait for Claude to respond (session history has messages)
    logger.info("Waiting for Claude response in session history...");
    type Message = { type: "user" | "assistant"; content: string };
    const { messages } = await waitFor(
      () => client.boxSessions.history({ id: boxId, sessionId: sessionId! }),
      {
        timeoutMs: 180_000, // 3 minutes
        pollIntervalMs: 5000,
        description: "Claude response in session history",
        until: (result: { messages: Message[] }) => result.messages.length >= 2, // user + assistant
      }
    );

    // Verify real messages exist
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages.some((m: Message) => m.type === "user")).toBe(true);
    expect(messages.some((m: Message) => m.type === "assistant")).toBe(true);

    // Verify assistant response has content
    const assistantMsg = messages.find((m: Message) => m.type === "assistant");
    expect(assistantMsg?.content.length).toBeGreaterThan(0);
    logger.info(
      {
        messageCount: messages.length,
        preview: assistantMsg?.content.slice(0, 100),
      },
      "Session history verified"
    );

    logger.info("=== Test Passed ===");
  }, 300_000); // 5 minute timeout for test
});
