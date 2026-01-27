/**
 * AI Tools E2E Integration Test
 *
 * Tests the complete flow:
 * 1. Deploy real sprite with box-agent
 * 2. Trigger Claude session via email
 * 3. Claude uses MCP `generate_image` tool
 * 4. Image generated via Fal.ai/Replicate
 * 5. Usage tracked in `ai_usage` table
 *
 * IMPORTANT: Full E2E flow requires:
 * - Server must be publicly accessible (sprites can't reach localhost)
 *
 * Requirements:
 * - SPRITES_TOKEN: Fly.io Sprites API token
 * - DATABASE_URL: PostgreSQL connection string (same as dev server)
 * - SERVER_URL: PUBLIC URL to reach the server (ngrok or deployed)
 *   - Default localhost:33000 only works for connectivity tests
 *
 * For local testing with ngrok:
 *   1. Start server: bun run dev
 *   2. Expose server: ngrok http 33000
 *   3. Run test with public URL:
 *      SERVER_URL=https://xxxx.ngrok.io SPRITES_TOKEN=xxx DATABASE_URL=xxx \
 *        bun test packages/sprites/src/__tests__/ai-tools-e2e.integration.test.ts
 *
 * For connectivity test only (no Claude/AI):
 *   SPRITES_TOKEN=xxx DATABASE_URL=xxx bun test packages/sprites/src/__tests__/ai-tools-e2e.integration.test.ts --test-name-pattern "Connectivity"
 */

import type { BoxId, UserId } from "@vps-claude/shared";

import {
  aiUsage,
  box,
  boxEmailSettings,
  createDb,
  type Database,
  user,
} from "@vps-claude/db";
import { createLogger } from "@vps-claude/logger";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";

import { createSpritesClient, type SpritesClient } from "..";

const logger = createLogger({ appName: "ai-tools-e2e-test" });

// Environment configuration
const SPRITES_TOKEN = process.env.SPRITES_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const SERVER_URL = process.env.SERVER_URL || "http://localhost:33000";

// Skip test if required env vars missing
const SKIP_TEST = !SPRITES_TOKEN || !DATABASE_URL;

// Full E2E requires public server URL
const CAN_RUN_FULL_E2E = !SERVER_URL.includes("localhost");

/**
 * Helper to wait for a condition with polling
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

describe.skipIf(SKIP_TEST)("AI Tools E2E - MCP + Claude", () => {
  let db: Database;
  let spritesClient: SpritesClient;
  let spriteName: string;
  let spriteUrl: string;
  let boxId: BoxId;
  let boxToken: string;
  let testUserId: UserId;

  // Helper to run shell commands on sprite (handles sprite-env exit code 255)
  async function execShell(cmd: string) {
    const scriptPath = `/tmp/exec-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`;
    await spritesClient.writeFile(
      spriteName,
      scriptPath,
      `#!/bin/bash\n${cmd}`
    );
    try {
      const result = await spritesClient.execCommand(
        spriteName,
        `/bin/bash ${scriptPath}`
      );
      try {
        await spritesClient.execCommand(spriteName, `/bin/rm ${scriptPath}`);
      } catch {
        // Ignore cleanup errors
      }
      return result;
    } catch (e: unknown) {
      // Sprites exec often returns exit code 255 even on success
      // Extract result from error if available
      if (
        e &&
        typeof e === "object" &&
        "result" in e &&
        e.result &&
        typeof e.result === "object"
      ) {
        const result = e.result as {
          stdout: string;
          stderr: string;
          exitCode: number;
        };
        return result;
      }
      throw e;
    }
  }

  beforeAll(async () => {
    console.log("\n=== AI Tools E2E Test Setup ===");
    console.log(`Server URL: ${SERVER_URL}`);
    console.log(`Database: ${DATABASE_URL?.slice(0, 30)}...`);

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
      // Try to find any existing user
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

    // 3. Create sprites client
    spritesClient = createSpritesClient({ token: SPRITES_TOKEN!, logger });
    console.log("Created sprites client");

    // 4. Create sprite with unique name
    const suffix = `ai-e2e-${Date.now().toString(36)}`;
    console.log(`Creating sprite: ${suffix}...`);

    const result = await spritesClient.createSprite({
      name: suffix,
      userId: "e2e-test",
      subdomain: suffix,
      envVars: {},
    });
    spriteName = result.spriteName;
    spriteUrl = result.url;
    console.log(`Sprite created: ${spriteName} at ${spriteUrl}`);

    // 5. Wait for sprite to initialize
    console.log("Waiting 10s for sprite to initialize...");
    await new Promise((r) => setTimeout(r, 10_000));

    // 6. Generate box token (64 chars required by box-agent validation)
    boxToken = randomBytes(32).toString("hex");
    const subdomain = `ai-test-${suffix}`;

    // 7. Set up box-agent with simplified direct approach
    // Avoid sprite-env services which has exit code issues
    const boxApiUrl = `${SERVER_URL}/box`;
    console.log(`Setting up box-agent with BOX_API_URL=${boxApiUrl}`);

    // Upload local box-agent binary (with debug logging)
    console.log("Step 1: Uploading local box-agent binary...");
    const boxAgentPath = new URL(
      "../../../../apps/box-agent/dist/box-agent-linux-x64",
      import.meta.url
    ).pathname;
    const boxAgentBinary = await Bun.file(boxAgentPath).arrayBuffer();
    console.log(`  Binary size: ${boxAgentBinary.byteLength} bytes`);
    await spritesClient.writeFile(
      spriteName,
      "/usr/local/bin/box-agent",
      Buffer.from(boxAgentBinary)
    );
    await execShell("chmod +x /usr/local/bin/box-agent");

    // Install Claude Code if not available
    console.log("Step 1.5: Checking/Installing Claude Code...");
    const claudeCheck = await execShell("which claude || echo 'not-found'");
    if (claudeCheck.stdout.includes("not-found")) {
      console.log("Claude Code not found, installing via npm...");
      await execShell(`
        npm install -g @anthropic-ai/claude-code || /.sprite/bin/bun add -g @anthropic-ai/claude-code || echo "Claude install failed"
        which claude || echo "Claude still not found after install"
      `);
    } else {
      console.log(`Claude Code found at: ${claudeCheck.stdout.trim()}`);
    }

    // Create directories - ~/.claude is where SDK looks for user settings
    console.log("Step 2: Creating directories...");
    await execShell(`
      mkdir -p /home/sprite/.inbox /home/sprite/.box-agent /home/sprite/.claude
    `);

    // Create MCP wrapper script that sources env vars
    console.log("Step 2.5: Creating MCP wrapper and Claude config...");
    const mcpWrapperScript = `#!/bin/bash
source /home/sprite/.bashrc.env 2>/dev/null || true
export BOX_AGENT_SECRET="${boxToken}"
export BOX_API_TOKEN="${boxToken}"
export BOX_API_URL="${boxApiUrl}"
export BOX_SUBDOMAIN="${subdomain}"
exec /usr/local/bin/box-agent mcp`;
    await spritesClient.writeFile(
      spriteName,
      "/home/sprite/start-mcp.sh",
      mcpWrapperScript
    );
    await execShell("chmod +x /home/sprite/start-mcp.sh");

    // Create Claude MCP config so Claude Code knows about the ai-tools MCP server
    // Write to ~/.claude/settings.json which is where SDK loads 'user' settings from
    const claudeConfig = {
      mcpServers: {
        "ai-tools": {
          command: "/home/sprite/start-mcp.sh",
          args: [],
        },
      },
    };
    await spritesClient.writeFile(
      spriteName,
      "/home/sprite/.claude/settings.json",
      JSON.stringify(claudeConfig, null, 2)
    );
    // Fix ownership so sprite user can read the config and scripts
    await execShell(`
      chown -R sprite:sprite /home/sprite/.claude
      chown sprite:sprite /home/sprite/start-mcp.sh
      chown sprite:sprite /home/sprite/.bashrc.env 2>/dev/null || true
    `);

    // Create env file
    console.log("Step 3: Creating env file...");
    const envFileContent = `BOX_AGENT_SECRET="${boxToken}"
BOX_API_TOKEN="${boxToken}"
BOX_API_URL="${boxApiUrl}"
BOX_SUBDOMAIN="${subdomain}"`;
    await spritesClient.writeFile(
      spriteName,
      "/home/sprite/.bashrc.env",
      envFileContent
    );

    // Start box-agent on port 8080 (default sprite HTTP port)
    console.log("Step 4: Starting box-agent on port 8080...");
    const startScript = `#!/bin/bash
export BOX_AGENT_SECRET="${boxToken}"
export BOX_API_TOKEN="${boxToken}"
export BOX_API_URL="${boxApiUrl}"
export BOX_SUBDOMAIN="${subdomain}"
export BOX_AGENT_PORT=8080
export BOX_INBOX_DIR=/home/sprite/.inbox
export BOX_DB_PATH=/home/sprite/.box-agent/sessions.db
exec /usr/local/bin/box-agent`;
    await spritesClient.writeFile(
      spriteName,
      "/home/sprite/start-box-agent.sh",
      startScript
    );

    await execShell(`
      chmod +x /home/sprite/start-box-agent.sh
      nohup /home/sprite/start-box-agent.sh > /home/sprite/.box-agent.log 2>&1 &
      sleep 2
    `);

    // 8. Wait for box-agent to start
    console.log("Waiting 10s for box-agent to stabilize...");
    await new Promise((r) => setTimeout(r, 10_000));

    // 9. Verify box-agent is running
    const processCheck = await execShell(`
      echo "box-agent: $(pgrep -f box-agent > /dev/null && echo 'running' || echo 'not running')"
      echo "Listening ports:"
      netstat -tlnp 2>/dev/null | grep -E "(8080|9999)" || ss -tlnp 2>/dev/null | grep -E "(8080|9999)" || echo "No ports found"
      echo ""
      echo "Recent logs:"
      tail -20 /home/sprite/.box-agent.log 2>/dev/null || echo "No logs"
    `);
    console.log("Service status:\n", processCheck.stdout);

    // Debug: Test network connectivity to ngrok from sprite
    console.log("Debug: Testing network connectivity to ngrok...");
    const networkTest = await execShell(`
      echo "Testing DNS..."
      nslookup f8112d3a66a4.ngrok-free.app 2>&1 || echo "DNS failed"
      echo ""
      echo "Testing HTTP..."
      curl -sS --max-time 10 -H "ngrok-skip-browser-warning: true" "https://f8112d3a66a4.ngrok-free.app/health" 2>&1 || echo "HTTP failed"
    `);
    console.log(networkTest.stdout);

    // 10. Create box record in database
    const [boxRecord] = await db
      .insert(box)
      .values({
        name: `AI Test Box ${suffix}`,
        subdomain,
        status: "running",
        spriteName,
        spriteUrl,
        userId: testUserId,
      })
      .returning();

    boxId = boxRecord!.id;
    console.log(`Box record created: ${boxId}`);

    // 11. Create email settings with box token
    await db.insert(boxEmailSettings).values({
      boxId: boxRecord!.id,
      agentSecret: boxToken,
    });
    console.log(
      `Email settings created with token: ${boxToken.slice(0, 8)}...`
    );

    console.log("\n=== Setup Complete ===\n");
  }, 300_000); // 5 minute timeout for setup

  afterAll(async () => {
    console.log("\n=== Cleanup ===");

    // Cleanup: delete box records
    if (boxId) {
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

    // Cleanup: delete sprite
    if (spriteName) {
      try {
        await spritesClient.deleteSprite(spriteName);
        console.log(`Sprite deleted: ${spriteName}`);
      } catch (e) {
        console.warn("Failed to delete sprite:", e);
      }
    }

    console.log("=== Cleanup Complete ===\n");
  }, 60_000);

  test("Claude uses generate_image MCP tool", async () => {
    console.log("\n=== Test: Claude generates image via MCP ===");

    // Warn if full E2E won't work
    if (!CAN_RUN_FULL_E2E) {
      console.warn(
        "\n⚠️  WARNING: Full E2E test may not complete successfully:"
      );
      if (SERVER_URL.includes("localhost")) {
        console.warn("   - SERVER_URL is localhost (sprites can't reach it)");
        console.warn("   - Use ngrok or deploy server publicly");
      }
      console.warn("");
    }

    // Build email payload (must match InboundEmailSchema in box-agent)
    const emailId = `test-${Date.now()}`;
    const emailPayload = {
      id: emailId,
      messageId: `<${emailId}@e2e-test.local>`,
      from: {
        email: "tester@example.com",
        name: "E2E Test",
      },
      to: `agent@${spriteName}.sprites.dev`,
      subject: "Generate a test image",
      body: {
        text: "Please use the generate_image tool to create a simple image of a red circle on a white background. Just call the tool directly, no explanation needed.",
      },
      receivedAt: new Date().toISOString(),
    };

    // POST email to box-agent via internal curl (sprites.dev external routing unreliable)
    // Route is /email/receive on port 8080 (box-agent configured port)
    console.log(`Sending email via internal curl...`);

    // First check if box-agent is actually responding
    const healthCheck = await execShell(`
      echo "Health check:"
      curl -s http://localhost:8080/health || echo "HEALTH FAILED"
      echo ""
      echo "Email endpoint test:"
      curl -v -X POST http://localhost:8080/email/receive \\
        -H "Content-Type: application/json" \\
        -H "X-Box-Secret: ${boxToken}" \\
        -d '${JSON.stringify(emailPayload).replace(/'/g, "'\\''")}' 2>&1 || echo "CURL FAILED"
    `);

    console.log("Email POST result:\n", healthCheck.stdout);
    if (healthCheck.stderr) {
      console.log("Stderr:", healthCheck.stderr);
    }

    const emailResult = healthCheck;

    // Check if response indicates success
    const emailResponse = emailResult.stdout;
    const isSuccess =
      emailResponse.includes('"success":true') ||
      emailResponse.includes("success");

    if (!isSuccess) {
      console.error(`Email POST may have failed: ${emailResponse}`);

      // Debug: check box-agent logs
      console.log("\n=== Box-agent logs ===");
      const logs = await execShell(
        "tail -50 /.sprite/logs/services/box-agent.log 2>/dev/null || echo 'No logs'"
      );
      console.log(logs.stdout);
    }

    expect(isSuccess).toBe(true);
    console.log("Email sent successfully, waiting for Claude session...");

    // Wait for Claude session to complete and generate image
    // Poll ai_usage table for record with our boxId
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

    // If no usage found, check box-agent logs for debugging
    if (!usage) {
      console.log("\n=== Debug: Box-agent logs ===");
      const logs = await execShell(
        "tail -200 /home/sprite/.box-agent.log 2>/dev/null || echo 'No logs'"
      );
      console.log(logs.stdout);

      console.log("\n=== Debug: Environment check ===");
      const envCheck = await execShell(
        "ps aux | grep box-agent | head -5; echo '---'; cat /home/sprite/start-box-agent.sh | head -20"
      );
      console.log(envCheck.stdout);

      console.log("\n=== Debug: Claude config ===");
      const claudeConfigCheck = await execShell(
        "cat /home/sprite/.claude/settings.json 2>/dev/null || echo 'No Claude config'"
      );
      console.log(claudeConfigCheck.stdout);

      console.log("\n=== Debug: Claude processes and logs ===");
      const claudeCheck = await execShell(`
        echo "Claude-related processes:"
        ps aux | grep -E "(claude|node|bun)" | head -10 || echo "No Claude processes"
        echo ""
        echo "Looking for Claude logs:"
        ls -la /home/sprite/.config/claude/ 2>/dev/null || echo "No claude config dir"
        ls -la /tmp/*.log 2>/dev/null | head -5 || echo "No tmp logs"
        echo ""
        echo "MCP script:"
        cat /home/sprite/start-mcp.sh 2>/dev/null || echo "No MCP script"
      `);
      console.log(claudeCheck.stdout);

      console.log("\n=== Debug: Check if email was received ===");
      const inbox = await execShell("ls -la /home/sprite/.inbox/ 2>/dev/null");
      console.log(inbox.stdout);
    }

    // Assertions
    expect(usage).toBeDefined();
    expect(usage?.capability).toBe("image_generation");
    expect(usage?.success).toBe(true);
    expect(usage?.provider).toMatch(/^(fal|replicate)$/);
    expect(usage?.userId).toBe(testUserId);
    expect(usage?.boxId).toBe(boxId);

    console.log("\n=== Test Passed ===");
    console.log(`Image generated via ${usage?.provider}`);
    if (usage?.durationMs) {
      console.log(`Duration: ${usage.durationMs}ms`);
    }
  }, 240_000); // 4 minute timeout for test
});

/**
 * Quick connectivity test - verify box-agent health endpoint works
 *
 * Useful for debugging when the full test fails
 */
describe.skipIf(SKIP_TEST)("AI Tools E2E - Connectivity Check", () => {
  let spritesClient: SpritesClient;
  let spriteName: string;
  let spriteUrl: string;

  // Helper to run shell commands (handles sprite-env exit code 255)
  async function execShell(cmd: string) {
    const scriptPath = `/tmp/exec-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`;
    await spritesClient.writeFile(
      spriteName,
      scriptPath,
      `#!/bin/bash\n${cmd}`
    );
    try {
      const result = await spritesClient.execCommand(
        spriteName,
        `/bin/bash ${scriptPath}`
      );
      try {
        await spritesClient.execCommand(spriteName, `/bin/rm ${scriptPath}`);
      } catch {
        // Ignore cleanup errors
      }
      return result;
    } catch (e: unknown) {
      // Sprites exec often returns exit code 255 even on success
      // Extract result from error if available
      if (
        e &&
        typeof e === "object" &&
        "result" in e &&
        e.result &&
        typeof e.result === "object"
      ) {
        const result = e.result as {
          stdout: string;
          stderr: string;
          exitCode: number;
        };
        return result;
      }
      throw e;
    }
  }

  beforeAll(async () => {
    spritesClient = createSpritesClient({ token: SPRITES_TOKEN!, logger });

    const suffix = `conn-test-${Date.now().toString(36)}`;
    const result = await spritesClient.createSprite({
      name: suffix,
      userId: "conn-test",
      subdomain: suffix,
      envVars: {},
    });
    spriteName = result.spriteName;
    spriteUrl = result.url;

    console.log(`Sprite created: ${spriteName} at ${spriteUrl}`);
    await new Promise((r) => setTimeout(r, 5_000));

    // Use full setupSprite like production - this sets up nginx which handles HTTP routing
    const boxToken = randomBytes(32).toString("hex");

    console.log("Running full setupSprite (with nginx)...");
    try {
      await spritesClient.setupSprite({
        spriteName,
        boxAgentBinaryUrl:
          "https://github.com/grmkris/claude-vps/releases/latest/download/box-agent-linux-x64",
        envVars: {
          BOX_AGENT_SECRET: boxToken,
          BOX_API_TOKEN: boxToken,
          BOX_API_URL: `${SERVER_URL}/box`,
          BOX_SUBDOMAIN: suffix,
        },
        spriteUrl,
      });
      console.log("setupSprite completed successfully");
    } catch (e) {
      // setupSprite may throw on sprite-env service creation (exit code 255)
      // but services may still be running
      console.log("setupSprite error (services may still work):", e);
    }

    // Set sprite URL to public access
    console.log("Setting sprite URL to public...");
    await spritesClient.setUrlAuth(spriteName, "public");

    console.log("Waiting 20s for services to stabilize...");
    await new Promise((r) => setTimeout(r, 20_000));

    // Debug: check if running
    const check = await execShell(`
      echo "Processes:"
      pgrep -la "box-agent|nginx" || echo "Not running"
      echo ""
      echo "Registered services:"
      sprite-env services list 2>/dev/null || echo "Cannot list services"
      echo ""
      echo "Local health check (via nginx on 8080):"
      curl -s http://localhost:8080/health || echo "Cannot reach localhost:8080"
      echo ""
      echo "Direct box-agent check (port 9999):"
      curl -s http://localhost:9999/health || echo "Cannot reach localhost:9999"
    `);
    console.log("Status check:\n", check.stdout);
  }, 120_000);

  afterAll(async () => {
    if (spriteName) {
      await spritesClient.deleteSprite(spriteName).catch(console.warn);
    }
  }, 30_000);

  test("box-agent health endpoint responds", async () => {
    // Test via internal curl since sprites.dev external routing is unreliable
    console.log("Testing internal health endpoint...");

    const healthResult = await execShell(`
      echo "nginx (8080):"
      curl -s http://localhost:8080/health || echo "FAILED"
      echo ""
      echo "box-agent (9999):"
      curl -s http://localhost:9999/health || echo "FAILED"
    `);
    console.log("Health check:\n", healthResult.stdout);

    // Verify box-agent responds
    const success = healthResult.stdout.includes('"status":"ok"');
    expect(success).toBe(true);
  }, 30_000);
});
