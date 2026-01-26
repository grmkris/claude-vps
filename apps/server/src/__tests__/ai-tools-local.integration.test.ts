/**
 * AI Tools Local E2E Integration Test
 *
 * Tests the complete AI tools flow by running box-agent locally:
 * 1. Run box-agent locally (configurable port)
 * 2. POST email to trigger Claude session
 * 3. Claude uses MCP `generate_image` tool
 * 4. MCP calls local server (localhost:33000)
 * 5. Verify ai_usage record in database
 *
 * Benefits over sprite-based test:
 * - No sprite deployment (~60s saved)
 * - No ngrok tunneling needed
 * - Direct localhost communication
 * - Easy debugging with local logs
 *
 * Prerequisites:
 * - `bun run dev` running (server on localhost:33000)
 * - Dev database running with at least one user
 * - Claude Code installed (`bun add -g @anthropic-ai/claude-code`)
 *
 * Run:
 *   cd apps/box-agent && bun test src/__tests__/ai-tools-local.integration.test.ts
 */

import type { BoxId, UserId } from "@vps-claude/shared";
import type { ChildProcess } from "node:child_process";

import {
  aiUsage,
  box,
  boxEmailSettings,
  createDb,
  type Database,
  eq,
  user,
} from "@vps-claude/db";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Environment configuration
const DATABASE_URL = process.env.DATABASE_URL;
const SERVER_URL = process.env.SERVER_URL || "http://localhost:33000";
const BOX_AGENT_PORT = 8080;

// Skip test if required env vars missing
const SKIP_TEST = !DATABASE_URL;

if (SKIP_TEST) {
  console.warn("\n⚠️  Skipping AI Tools Local E2E test:");
  if (!DATABASE_URL) console.warn("   - DATABASE_URL not set");
  console.warn("\nSet required env vars and ensure dev server is running.\n");
}

/**
 * Wait for a condition with polling
 */
async function waitFor<T>(
  fn: () => Promise<T | null | undefined>,
  options: { timeoutMs: number; pollIntervalMs: number; description: string }
): Promise<T | null> {
  const startTime = Date.now();
  let lastResult: T | null | undefined = null;

  while (Date.now() - startTime < options.timeoutMs) {
    lastResult = await fn();
    if (lastResult) {
      return lastResult;
    }
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`Waiting for ${options.description}... ${elapsed}s elapsed`);
    await new Promise((r) => setTimeout(r, options.pollIntervalMs));
  }

  return lastResult ?? null;
}

/**
 * Wait for HTTP endpoint to respond
 */
async function waitForHealth(
  url: string,
  timeoutMs = 30_000
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        return true;
      }
    } catch {
      // Ignore errors, keep polling
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  return false;
}

describe.skipIf(SKIP_TEST)("AI Tools Local E2E", () => {
  let db: Database;
  let boxAgentProcess: ChildProcess | null = null;
  let boxId: BoxId;
  let boxToken: string;
  let testUserId: UserId;
  let tempDir: string;

  beforeAll(async () => {
    console.log("\n=== AI Tools Local E2E Test Setup ===");
    console.log(`Server URL: ${SERVER_URL}`);
    console.log(`Box Agent Port: ${BOX_AGENT_PORT}`);

    // 1. Connect to database
    db = createDb({
      type: "bun-sql",
      connectionString: DATABASE_URL!,
    });
    console.log("Connected to database");

    // 2. Get or create test user
    let [existingUser] = await db
      .select()
      .from(user)
      .where(eq(user.email, "e2e-test@vps-claude.dev"))
      .limit(1);

    if (!existingUser) {
      [existingUser] = await db.select().from(user).limit(1);
      if (!existingUser) {
        throw new Error(
          "No users in database. Start the dev server and create a user first."
        );
      }
      console.log(`Using existing user: ${existingUser.email}`);
    } else {
      console.log(`Using test user: ${existingUser.email}`);
    }
    testUserId = existingUser.id;

    // 3. Create temp directory for test files
    tempDir = join(tmpdir(), `box-agent-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    await mkdir(join(tempDir, "inbox"), { recursive: true });
    console.log(`Temp directory: ${tempDir}`);

    // 4. Generate box token
    boxToken = randomBytes(32).toString("hex");
    const subdomain = `local-test-${Date.now().toString(36)}`;

    // 5. Create box record in database
    const [boxRecord] = await db
      .insert(box)
      .values({
        name: `Local E2E Test Box`,
        subdomain,
        status: "running",
        spriteName: `local-${subdomain}`,
        spriteUrl: `http://localhost:${BOX_AGENT_PORT}`,
        userId: testUserId,
      })
      .returning();

    boxId = boxRecord!.id;
    console.log(`Box record created: ${boxId}`);

    // 6. Create email settings with box token
    await db.insert(boxEmailSettings).values({
      boxId: boxRecord!.id,
      agentSecret: boxToken,
    });
    console.log(
      `Email settings created with token: ${boxToken.slice(0, 8)}...`
    );

    // 7. Create MCP wrapper script for local execution
    // This script runs box-agent in MCP mode with correct env vars
    const mcpScriptPath = join(tempDir, "start-mcp.sh");
    const boxAgentDir = join(import.meta.dir, "..");
    const mcpScript = `#!/bin/bash
export BOX_AGENT_SECRET="${boxToken}"
export BOX_API_TOKEN="${boxToken}"
export BOX_API_URL="${SERVER_URL}/box"
export BOX_SUBDOMAIN="${subdomain}"
export BOX_AGENT_PORT=${BOX_AGENT_PORT}
export BOX_INBOX_DIR="${join(tempDir, "inbox")}"
export BOX_DB_PATH="${join(tempDir, "sessions.db")}"
cd "${boxAgentDir}"
exec bun run ./src/index.ts mcp
`;
    await writeFile(mcpScriptPath, mcpScript, { mode: 0o755 });
    console.log(`MCP wrapper script created: ${mcpScriptPath}`);

    // 8. Start box-agent as child process
    console.log("Starting box-agent process...");
    boxAgentProcess = spawn("bun", ["run", "./src/index.ts"], {
      cwd: boxAgentDir,
      env: {
        ...process.env,
        BOX_API_URL: `${SERVER_URL}/box`,
        BOX_API_TOKEN: boxToken,
        BOX_AGENT_SECRET: boxToken,
        BOX_SUBDOMAIN: subdomain,
        BOX_AGENT_PORT: String(BOX_AGENT_PORT),
        BOX_INBOX_DIR: join(tempDir, "inbox"),
        BOX_DB_PATH: join(tempDir, "sessions.db"),
        // Override MCP script path for local testing
        BOX_MCP_SCRIPT_PATH: mcpScriptPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Log stdout/stderr for debugging
    boxAgentProcess.stdout?.on("data", (data) => {
      console.log(`[box-agent stdout] ${data.toString().trim()}`);
    });
    boxAgentProcess.stderr?.on("data", (data) => {
      console.log(`[box-agent stderr] ${data.toString().trim()}`);
    });

    boxAgentProcess.on("error", (err) => {
      console.error("[box-agent] Process error:", err);
    });

    boxAgentProcess.on("exit", (code, signal) => {
      console.log(
        `[box-agent] Process exited with code=${code} signal=${signal}`
      );
    });

    // 9. Wait for health check
    console.log(
      `Waiting for box-agent health check at http://localhost:${BOX_AGENT_PORT}/health...`
    );
    const healthy = await waitForHealth(
      `http://localhost:${BOX_AGENT_PORT}/health`,
      30_000
    );

    if (!healthy) {
      throw new Error("Box-agent failed to start - health check timeout");
    }
    console.log("Box-agent is healthy!");

    console.log("\n=== Setup Complete ===\n");
  }, 60_000);

  afterAll(async () => {
    console.log("\n=== Cleanup ===");

    // Kill box-agent process
    if (boxAgentProcess) {
      console.log("Killing box-agent process...");
      boxAgentProcess.kill("SIGTERM");
      // Wait a bit for graceful shutdown
      await new Promise((r) => setTimeout(r, 1000));
      if (!boxAgentProcess.killed) {
        boxAgentProcess.kill("SIGKILL");
      }
    }

    // Cleanup database records
    if (boxId && db) {
      try {
        await db
          .delete(boxEmailSettings)
          .where(eq(boxEmailSettings.boxId, boxId));
        console.log("Deleted email settings");
      } catch (e) {
        console.warn("Failed to delete email settings:", e);
      }

      try {
        await db.delete(aiUsage).where(eq(aiUsage.boxId, boxId));
        console.log("Deleted ai_usage records");
      } catch (e) {
        console.warn("Failed to delete ai_usage:", e);
      }

      try {
        await db.delete(box).where(eq(box.id, boxId));
        console.log("Deleted box record");
      } catch (e) {
        console.warn("Failed to delete box:", e);
      }
    }

    // Cleanup temp directory
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true });
        console.log(`Deleted temp directory: ${tempDir}`);
      } catch (e) {
        console.warn("Failed to delete temp directory:", e);
      }
    }

    console.log("=== Cleanup Complete ===\n");
  }, 30_000);

  test("Claude uses generate_image MCP tool", async () => {
    console.log("\n=== Test: Claude generates image via MCP ===");

    // Build email payload
    const emailId = `test-${Date.now()}`;
    const emailPayload = {
      id: emailId,
      messageId: `<${emailId}@local-test>`,
      from: {
        email: "tester@example.com",
        name: "Local E2E Test",
      },
      to: "agent@local-test.dev",
      subject: "Generate a test image",
      body: {
        text: "Please use the generate_image tool to create a simple image of a red circle on a white background. Just call the tool directly, no explanation needed.",
      },
      receivedAt: new Date().toISOString(),
    };

    // POST email to box-agent
    console.log(
      `Sending email to http://localhost:${BOX_AGENT_PORT}/email/receive...`
    );
    const response = await fetch(
      `http://localhost:${BOX_AGENT_PORT}/email/receive`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Box-Secret": boxToken,
        },
        body: JSON.stringify(emailPayload),
      }
    );

    const responseBody = await response.json();
    console.log("Email POST response:", JSON.stringify(responseBody));

    expect(response.ok).toBe(true);
    expect(responseBody).toEqual({ success: true });

    console.log("Email sent successfully, waiting for Claude session...");
    console.log("(This may take 1-3 minutes as Claude processes the request)");

    // Poll for ai_usage record
    const usage = await waitFor(
      async () => {
        const [record] = await db
          .select()
          .from(aiUsage)
          .where(eq(aiUsage.boxId, boxId))
          .limit(1);
        if (record) {
          console.log(
            `Found ai_usage: capability=${record.capability}, success=${record.success}, provider=${record.provider}`
          );
        }
        return record;
      },
      {
        timeoutMs: 180_000, // 3 minutes for Claude session
        pollIntervalMs: 5_000,
        description: "ai_usage record",
      }
    );

    // If no usage found, show debug info
    if (!usage) {
      console.log("\n=== Debug: No ai_usage record found ===");
      console.log("Check that:");
      console.log("  1. Dev server is running on localhost:33000");
      console.log(
        "\nBox-agent logs should show Claude session activity above."
      );
    }

    // Assertions
    expect(usage).toBeDefined();
    expect(usage?.capability).toBe("image_generation");
    expect(usage?.success).toBe(true);
    expect(usage?.provider).toBe("fal");
    expect(usage?.userId).toBe(testUserId);
    expect(usage?.boxId).toBe(boxId);

    console.log("\n=== Test Passed ===");
    console.log(`Image generated via ${usage?.provider}`);
    if (usage?.durationMs) {
      console.log(`Duration: ${usage.durationMs}ms`);
    }
  }, 240_000); // 4 minute timeout
});
