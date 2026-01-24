#!/usr/bin/env bun
import { createLogger } from "@vps-claude/logger";

import { createSpritesClient } from "../packages/sprites/src/sprites-client";

const logger = createLogger({ appName: "vps-claude-server" });

const SPRITES_TOKEN =
  process.env.SPRITES_TOKEN ||
  "kris-33/1426884/b3cb4fe892401a512bd305ec223d664d/7f29429b46d41ff32885bb7d143bb2a566908d790ce12c546291644125a2f073";

async function testSprite() {
  console.log("=== Sprite Test: Create & Exec ===\n");

  const client = createSpritesClient({ token: SPRITES_TOKEN, logger });

  // Generate unique sprite name
  const spriteName = `test-sprite-${Date.now()}`;
  console.log(`Creating sprite: ${spriteName}...`);

  try {
    // Create sprite
    const sprite = await client.createSprite({
      name: spriteName,
      userId: "test-user",
      subdomain: spriteName,
      envVars: {},
    });
    console.log(`✓ Sprite created: ${sprite.spriteName}`);
    console.log(`  URL: ${sprite.url}\n`);

    // Give sprite a moment to initialize
    console.log("Waiting a moment for sprite to initialize...");
    await new Promise((resolve) => setTimeout(resolve, 10000));

    // Execute simple commands (HTTP exec only supports single executables without args)
    console.log("\n1. Executing: pwd");
    const result1 = await client.execCommand(sprite.spriteName, "pwd");
    console.log(`   Output: ${result1.stdout.trim()}`);

    console.log("\n2. Executing: whoami");
    const result2 = await client.execCommand(sprite.spriteName, "whoami");
    console.log(`   Output: ${result2.stdout.trim()}`);

    console.log("\n3. Executing: /bin/ls (current dir)");
    const result3 = await client.execCommand(sprite.spriteName, "/bin/ls");
    console.log(`   Output: ${result3.stdout.trim() || "(empty)"}`);

    console.log("\n4. Executing: /usr/bin/env");
    const result4 = await client.execCommand(sprite.spriteName, "/usr/bin/env");
    console.log(`   Output (first 10 lines):`);
    console.log(
      result4.stdout
        .split("\n")
        .slice(0, 10)
        .map((l) => `     ${l}`)
        .join("\n")
    );

    console.log("\n✓ All commands executed successfully");
    console.log("\nNote: HTTP exec only supports single executable paths.");
    console.log(
      "For commands with arguments, use WebSocket exec (not yet implemented)."
    );

    // Check sprite info
    console.log("\n--- Sprite Info ---");
    const info = await client.getSprite(sprite.spriteName);
    console.log(JSON.stringify(info, null, 2));

    // Cleanup option
    console.log("\n--- Cleanup ---");
    const cleanup = process.argv.includes("--cleanup");
    if (cleanup) {
      console.log(`Deleting sprite: ${sprite.spriteName}...`);
      await client.deleteSprite(sprite.spriteName);
      console.log("✓ Sprite deleted");
    } else {
      console.log(`Sprite kept: ${sprite.spriteName}`);
      console.log("To delete: bun scripts/test-sprite.ts --cleanup");
    }
  } catch (error) {
    console.error("✗ Error:", error);
    process.exit(1);
  }
}

testSprite().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
