/**
 * API E2E Test - SDK Only
 *
 * True E2E test that works against any environment (dev/staging/prod).
 * Uses only the SDK - no direct database access.
 *
 * Tests the complete flow:
 * 1. Create box via SDK
 * 2. Wait for deployment
 * 3. Send real email via Resend
 * 4. Verify email delivered and Claude session created via SDK
 *
 * Prerequisites:
 * - Server running (local dev or remote)
 * - Valid user credentials
 * - Resend API key for sending test emails
 *
 * Run:
 *   SERVER_URL=http://localhost:33000 \
 *   E2E_USER_EMAIL=xxx E2E_USER_PASSWORD=xxx \
 *   E2E_RESEND_API_KEY=re_xxx AGENTS_DOMAIN=yoda.fun \
 *     bun test tests/e2e/api-e2e.test.ts
 */

import { createClient, signIn, type AppRouterClient } from "@vps-claude/sdk";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Resend } from "resend";

// Environment configuration
const SERVER_URL = process.env.SERVER_URL || "http://localhost:33000";
const E2E_USER_EMAIL = process.env.E2E_USER_EMAIL;
const E2E_USER_PASSWORD = process.env.E2E_USER_PASSWORD;
const E2E_RESEND_API_KEY = process.env.E2E_RESEND_API_KEY;
const AGENTS_DOMAIN = process.env.AGENTS_DOMAIN || "yoda.fun";

// Skip test if required env vars missing
const SKIP_TEST = !E2E_USER_EMAIL || !E2E_USER_PASSWORD || !E2E_RESEND_API_KEY;

if (SKIP_TEST) {
  console.warn("\n⚠️  Skipping API E2E test - missing env vars:");
  if (!E2E_USER_EMAIL) console.warn("   - E2E_USER_EMAIL");
  if (!E2E_USER_PASSWORD) console.warn("   - E2E_USER_PASSWORD");
  if (!E2E_RESEND_API_KEY) console.warn("   - E2E_RESEND_API_KEY");
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
  let resend: Resend;
  let boxId: `box_${string}`;
  let subdomain: string;

  beforeAll(async () => {
    console.log("\n=== API E2E Test Setup ===");
    console.log(`Server URL: ${SERVER_URL}`);
    console.log(`Agents Domain: ${AGENTS_DOMAIN}`);

    // 1. Sign in via SDK
    console.log(`Signing in as ${E2E_USER_EMAIL}...`);
    const { sessionToken, error: authError } = await signIn(
      SERVER_URL,
      E2E_USER_EMAIL!,
      E2E_USER_PASSWORD!
    );

    if (authError || !sessionToken) {
      throw new Error(`Authentication failed: ${authError}`);
    }
    console.log("Authenticated successfully");

    // 2. Create SDK client
    client = createClient({ baseUrl: SERVER_URL, sessionToken });
    console.log("SDK client created");

    // 3. Create Resend client for sending test emails
    resend = new Resend(E2E_RESEND_API_KEY);
    console.log("Resend client created");

    // 4. Create box via SDK
    console.log("Creating box via SDK...");
    const { box } = await client.box.create({
      name: `E2E Test Box ${Date.now().toString(36)}`,
    });
    boxId = box.id;
    subdomain = box.subdomain;
    console.log(`Box created: ${boxId}, subdomain: ${subdomain}`);

    // 5. Wait for box deployment via SDK
    console.log("Waiting for box deployment...");
    await waitFor(
      async () => {
        const { progress } = await client.boxDetails.deployProgress({
          id: boxId,
        });
        if (progress) {
          console.log(
            `Deploy progress: ${progress.step}/${progress.total} - ${progress.message}`
          );
        }
        return progress;
      },
      {
        timeoutMs: 5 * 60 * 1000, // 5 minutes
        pollIntervalMs: 5000,
        description: "box deployment",
        until: (p) =>
          p !== null &&
          (p.step === p.total || p.message.toLowerCase().includes("error")),
      }
    );

    // Verify box is running
    const { box: currentBox } = await client.boxDetails.byId({ id: boxId });
    if (currentBox.status !== "running") {
      throw new Error(`Box deployment failed: status=${currentBox.status}`);
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

    // Send real email via Resend
    const toAddress = `${subdomain}@${AGENTS_DOMAIN}`;
    console.log(`Sending email to ${toAddress}...`);

    const { error: sendError } = await resend.emails.send({
      from: `e2e-test@${AGENTS_DOMAIN}`,
      to: toAddress,
      subject: `E2E Test ${Date.now()}`,
      text: "This is an automated E2E test. Please respond with a brief acknowledgment.",
    });

    if (sendError) {
      throw new Error(`Failed to send email: ${sendError.message}`);
    }
    console.log("Email sent successfully");

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
