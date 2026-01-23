#!/usr/bin/env bun
import { createSpritesClient } from "../packages/sprites/src/sprites-client";

const SPRITES_TOKEN =
  process.env.SPRITES_TOKEN ||
  "kris-33/1426884/b3cb4fe892401a512bd305ec223d664d/7f29429b46d41ff32885bb7d143bb2a566908d790ce12c546291644125a2f073";

async function cleanup() {
  console.log("=== Cleaning Up Test Sprites ===\n");

  const client = createSpritesClient({ token: SPRITES_TOKEN });

  // List all sprites
  console.log("Listing sprites...");
  const sprites = await client.listSprites();

  if (sprites.length === 0) {
    console.log("No sprites found");
    return;
  }

  console.log(`Found ${sprites.length} sprites:\n`);
  for (const sprite of sprites) {
    console.log(`  - ${sprite.name}`);
  }

  // Filter test sprites
  const testPrefix = "test-user-test-sprite-";
  const testSprites = sprites.filter((s) => s.name.startsWith(testPrefix));

  if (testSprites.length === 0) {
    console.log("\nNo test sprites to clean up");
    return;
  }

  console.log(`\nDeleting ${testSprites.length} test sprites...`);

  for (const sprite of testSprites) {
    try {
      console.log(`  Deleting: ${sprite.name}...`);
      await client.deleteSprite(sprite.name);
      console.log(`  ✓ Deleted: ${sprite.name}`);
    } catch (error) {
      console.log(`  ✗ Failed to delete ${sprite.name}: ${error}`);
    }
  }

  console.log("\n✓ Cleanup complete");
}

cleanup().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
