#!/usr/bin/env bun
import { createLogger } from "@vps-claude/logger";

import { createSpritesClient } from "../packages/sprites/src/sprites-client";

const logger = createLogger({ appName: "cleanup-sprites", level: "info" });

const SPRITES_TOKEN =
  process.env.SPRITES_TOKEN ||
  "kris-33/1426884/b3cb4fe892401a512bd305ec223d664d/7f29429b46d41ff32885bb7d143bb2a566908d790ce12c546291644125a2f073";

async function cleanup() {
  logger.info("=== Cleaning Up Test Sprites ===");

  const client = createSpritesClient({ token: SPRITES_TOKEN, logger });

  // List all sprites
  logger.info("Listing sprites...");
  const sprites = await client.listSprites();

  if (sprites.length === 0) {
    logger.info("No sprites found");
    return;
  }

  logger.info({ count: sprites.length }, "Found sprites");
  for (const sprite of sprites) {
    logger.info({ name: sprite.name }, "Sprite");
  }

  // Filter test sprites
  const testPrefix = "test-user-test-sprite-";
  const testSprites = sprites.filter((s) => s.name.startsWith(testPrefix));

  if (testSprites.length === 0) {
    logger.info("No test sprites to clean up");
    return;
  }

  logger.info({ count: testSprites.length }, "Deleting test sprites");

  for (const sprite of testSprites) {
    try {
      logger.info({ name: sprite.name }, "Deleting sprite");
      await client.deleteSprite(sprite.name);
      logger.info({ name: sprite.name }, "Deleted sprite");
    } catch (error) {
      logger.error({ name: sprite.name, error }, "Failed to delete sprite");
    }
  }

  logger.info("Cleanup complete");
}

cleanup().catch((error) => {
  logger.fatal({ error }, "Fatal error");
  process.exit(1);
});
