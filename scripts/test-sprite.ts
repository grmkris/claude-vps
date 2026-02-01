#!/usr/bin/env bun
import { createLogger } from "@vps-claude/logger";

import { createSpritesClient } from "../packages/sprites/src/sprites-client";

const logger = createLogger({ appName: "test-sprite", level: "info" });

const SPRITES_TOKEN =
  process.env.SPRITES_TOKEN ||
  "kris-33/1426884/b3cb4fe892401a512bd305ec223d664d/7f29429b46d41ff32885bb7d143bb2a566908d790ce12c546291644125a2f073";

async function testSprite() {
  logger.info("=== Sprite Test: Create & Exec ===");

  const client = createSpritesClient({ token: SPRITES_TOKEN, logger });

  // Generate unique sprite name
  const spriteName = `test-sprite-${Date.now()}`;
  logger.info({ spriteName }, "Creating sprite");

  try {
    // Create sprite
    const sprite = await client.createSprite({
      name: spriteName,
      userId: "test-user",
      subdomain: spriteName,
      envVars: {},
    });
    logger.info({ spriteName: sprite.spriteName, url: sprite.url }, "Sprite created");

    // Give sprite a moment to initialize
    logger.info("Waiting for sprite to initialize...");
    await new Promise((resolve) => setTimeout(resolve, 10000));

    // Execute simple commands (HTTP exec only supports single executables without args)
    logger.info("Executing: pwd");
    const result1 = await client.execCommand(sprite.spriteName, "pwd");
    logger.info({ output: result1.stdout.trim() }, "pwd result");

    logger.info("Executing: whoami");
    const result2 = await client.execCommand(sprite.spriteName, "whoami");
    logger.info({ output: result2.stdout.trim() }, "whoami result");

    logger.info("Executing: /bin/ls");
    const result3 = await client.execCommand(sprite.spriteName, "/bin/ls");
    logger.info({ output: result3.stdout.trim() || "(empty)" }, "ls result");

    logger.info("Executing: /usr/bin/env");
    const result4 = await client.execCommand(sprite.spriteName, "/usr/bin/env");
    const envLines = result4.stdout.split("\n").slice(0, 10).join("\n");
    logger.info({ output: envLines }, "env result (first 10 lines)");

    logger.info("All commands executed successfully");
    logger.info("Note: HTTP exec only supports single executable paths. For commands with arguments, use WebSocket exec.");

    // Check sprite info
    logger.info("--- Sprite Info ---");
    const info = await client.getSprite(sprite.spriteName);
    logger.info({ info }, "Sprite info");

    // Cleanup option
    const cleanup = process.argv.includes("--cleanup");
    if (cleanup) {
      logger.info({ spriteName: sprite.spriteName }, "Deleting sprite");
      await client.deleteSprite(sprite.spriteName);
      logger.info("Sprite deleted");
    } else {
      logger.info({ spriteName: sprite.spriteName }, "Sprite kept");
      logger.info("To delete: bun scripts/test-sprite.ts --cleanup");
    }
  } catch (error) {
    logger.error({ error }, "Error during sprite test");
    process.exit(1);
  }
}

testSprite().catch((error) => {
  logger.fatal({ error }, "Fatal error");
  process.exit(1);
});
