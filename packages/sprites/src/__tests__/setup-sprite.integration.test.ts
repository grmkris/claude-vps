import { createLogger } from "@vps-claude/logger";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createSpritesClient, type SpritesClient } from "..";

const logger = createLogger({ appName: "vps-claude-server" });

const SPRITES_TOKEN = process.env.SPRITES_TOKEN;

/**
 * Full setupSprite end-to-end test
 * Creates a fresh sprite and runs the actual setupSprite() method
 * to validate all setup steps complete without hanging.
 *
 * Run with: SPRITES_TOKEN=xxx bun test packages/sprites/src/__tests__/setup-sprite.integration.test.ts
 */
describe.skipIf(!SPRITES_TOKEN)("setupSprite E2E", () => {
  let client: SpritesClient;
  let spriteName: string;
  let spriteUrl: string;

  // BOX_AGENT_SECRET needs >= 32 chars (box-agent validation)
  const TEST_SECRET =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const TEST_ENV_VARS = {
    BOX_AGENT_SECRET: TEST_SECRET,
    BOX_API_TOKEN: TEST_SECRET,
    BOX_API_URL: "https://example.com/box",
    BOX_SUBDOMAIN: "e2e-test-subdomain",
  };

  // Helper to run shell commands
  async function execShell(cmd: string) {
    const scriptPath = `/tmp/exec-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`;
    await client.writeFile(
      spriteName,
      scriptPath,
      `#!/bin/bash\nset -e\n${cmd}`
    );
    const result = await client.execCommand(
      spriteName,
      `/bin/bash ${scriptPath}`
    );
    try {
      await client.execCommand(spriteName, `/bin/rm ${scriptPath}`);
    } catch {
      // Ignore cleanup errors
    }
    return result;
  }

  beforeAll(async () => {
    client = createSpritesClient({ token: SPRITES_TOKEN!, logger });
    const suffix = Date.now().toString(36);

    console.log(`Creating sprite e2e-test-${suffix}...`);
    const result = await client.createSprite({
      name: `e2e-test-${suffix}`,
      userId: "e2e-test",
      subdomain: `e2e-test-${suffix}`,
      envVars: {},
    });
    spriteName = result.spriteName;
    spriteUrl = result.url;
    console.log(
      `Created sprite: ${spriteName} at ${spriteUrl}, waiting for init...`
    );

    // Wait for sprite initialization
    await new Promise((r) => setTimeout(r, 10_000));
    console.log("Sprite ready, starting E2E test");
  }, 90_000);

  afterAll(async () => {
    if (spriteName) {
      console.log(`Cleaning up sprite: ${spriteName}`);
      await client.deleteSprite(spriteName);
    }
  }, 30_000);

  test("full setupSprite deployment", async () => {
    console.log("\n=== Full setupSprite E2E test ===");
    console.log(`Sprite: ${spriteName}`);
    console.log("Running all setup steps via setupSprite()...\n");

    const startTime = Date.now();

    await client.setupSprite({
      spriteName,
      boxAgentBinaryUrl:
        "https://github.com/grmkris/claude-vps/releases/latest/download/box-agent-linux-x64",
      envVars: TEST_ENV_VARS,
      spriteUrl,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nsetupSprite completed in ${elapsed}s`);

    // Give services a moment to fully start
    console.log("Waiting 5s for services to stabilize...");
    await new Promise((r) => setTimeout(r, 5_000));

    // Verify all services are running
    console.log("\n=== Verifying services ===");
    const checks = await execShell(`
      echo "box-agent: $(pgrep -f box-agent > /dev/null && echo 'running' || echo 'not running')"
      echo "nginx: $(pgrep nginx > /dev/null && echo 'running' || echo 'not running')"
      echo "agent-app: $(pgrep -f 'bun.*start' > /dev/null && echo 'running' || echo 'not running')"
    `);
    console.log(checks.stdout);
    if (checks.stderr) console.log("Stderr:", checks.stderr);

    // Check sprite-env service logs for any errors
    console.log("\n=== Service logs (sprite-env) ===");
    const serviceLogs = await execShell(`
      echo "--- box-agent ---"
      tail -10 /.sprite/logs/services/box-agent.log 2>/dev/null || echo "No log"
      echo ""
      echo "--- nginx ---"
      tail -10 /.sprite/logs/services/nginx.log 2>/dev/null || echo "No log"
      echo ""
      echo "--- agent-app ---"
      tail -20 /.sprite/logs/services/agent-app.log 2>/dev/null || echo "No log"
    `);
    console.log(serviceLogs.stdout);

    // Assertions
    expect(checks.stdout).toContain("box-agent: running");
    expect(checks.stdout).toContain("nginx: running");
  }, 600_000); // 10 min timeout

  /**
   * Skill Installation Tests
   * Tests the skill installation flow that runs after setupSprite
   * Uses the same sprite from E2E test
   */
  describe("Skill Installation", () => {
    test("create skills root directory", async () => {
      console.log("\n=== Skill Install: Create root directory ===");
      const result = await execShell(`
        mkdir -p /home/sprite/.claude/skills
        chown -R sprite:sprite /home/sprite/.claude
        ls -la /home/sprite/.claude/
      `);
      console.log("Exit code:", result.exitCode);
      console.log("Stdout:", result.stdout);
      if (result.stderr) console.log("Stderr:", result.stderr);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("skills");
    }, 30_000);

    test("fetch skill metadata from skills.sh", async () => {
      console.log("\n=== Skill Install: Fetch metadata ===");
      const res = await fetch(
        "https://skills.sh/api/skills?search=frontend-design&limit=1"
      );
      expect(res.ok).toBe(true);
      const data = (await res.json()) as {
        skills: Array<{ id: string; topSource: string }>;
      };
      console.log("Response:", JSON.stringify(data, null, 2));
      expect(data.skills.length).toBeGreaterThan(0);
      expect(data.skills[0]?.topSource).toBeDefined();
    }, 30_000);

    test("create individual skill directory", async () => {
      console.log("\n=== Skill Install: Create skill directory ===");
      const skillId = "test-skill";
      const result = await execShell(`
        mkdir -p /home/sprite/.claude/skills/${skillId}
        chown sprite:sprite /home/sprite/.claude/skills/${skillId}
        ls -la /home/sprite/.claude/skills/
      `);
      console.log("Exit code:", result.exitCode);
      console.log("Stdout:", result.stdout);
      if (result.stderr) console.log("Stderr:", result.stderr);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(skillId);
    }, 30_000);

    test("write SKILL.md via filesystem API", async () => {
      console.log("\n=== Skill Install: Write SKILL.md ===");
      const skillId = "test-skill";
      const content =
        "# Test Skill\n\nThis is a test skill for integration testing.";

      await client.writeFile(
        spriteName,
        `/home/sprite/.claude/skills/${skillId}/SKILL.md`,
        content,
        { mkdir: true }
      );

      // Verify file was written
      const verify = await execShell(
        `cat /home/sprite/.claude/skills/${skillId}/SKILL.md`
      );
      console.log("Exit code:", verify.exitCode);
      console.log("Content:", verify.stdout);
      expect(verify.exitCode).toBe(0);
      expect(verify.stdout).toContain("Test Skill");
    }, 30_000);

    test("set ownership of SKILL.md", async () => {
      console.log("\n=== Skill Install: Set ownership ===");
      const skillId = "test-skill";
      const result = await execShell(`
        chown sprite:sprite /home/sprite/.claude/skills/${skillId}/SKILL.md
        ls -la /home/sprite/.claude/skills/${skillId}/
      `);
      console.log("Exit code:", result.exitCode);
      console.log("Stdout:", result.stdout);
      if (result.stderr) console.log("Stderr:", result.stderr);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("SKILL.md");
      expect(result.stdout).toContain("sprite");
    }, 30_000);

    test("verify complete skill installation", async () => {
      console.log("\n=== Skill Install: Verification ===");
      const result = await execShell(`
        echo "=== Skills directory structure ==="
        find /home/sprite/.claude/skills -type f -o -type d 2>/dev/null | head -20

        echo ""
        echo "=== SKILL.md contents ==="
        cat /home/sprite/.claude/skills/test-skill/SKILL.md

        echo ""
        echo "=== File permissions ==="
        stat /home/sprite/.claude/skills/test-skill/SKILL.md
      `);
      console.log("Stdout:", result.stdout);
      if (result.stderr) console.log("Stderr:", result.stderr);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Test Skill");
    }, 30_000);
  });
});
