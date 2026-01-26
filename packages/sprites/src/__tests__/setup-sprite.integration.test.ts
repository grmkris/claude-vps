import { createLogger } from "@vps-claude/logger";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createSpritesClient, type SpritesClient } from "..";

const logger = createLogger({ appName: "vps-claude-server" });

const SPRITES_TOKEN = process.env.SPRITES_TOKEN;

/**
 * Integration test for setupSprite steps
 * Runs each step individually to identify which one fails
 *
 * DISCOVERY: Sprites exec() does NOT use a shell - commands run directly.
 * All shell syntax (heredocs, redirects, export) must be wrapped in bash -c '...'
 *
 * Run with: SPRITES_TOKEN=xxx bun test packages/sprites/src/__tests__/setup-sprite.integration.test.ts
 */
describe.skipIf(!SPRITES_TOKEN)("setupSprite Integration", () => {
  let client: SpritesClient;
  let spriteName: string;

  const TEST_PASSWORD = "testpass123";
  const TEST_ENV_VARS = {
    BOX_AGENT_SECRET: "test-secret-123",
    BOX_API_TOKEN: "test-secret-123",
    BOX_API_URL: "https://example.com/box",
    BOX_SUBDOMAIN: "test-subdomain",
  };

  // Helper to run shell commands properly
  // Writes script to temp file, executes it (Sprites exec has no shell)
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

    console.log(`Creating sprite setup-test-${suffix}...`);
    const result = await client.createSprite({
      name: `setup-test-${suffix}`,
      userId: "test-user",
      subdomain: `setup-test-${suffix}`,
      envVars: {},
    });
    spriteName = result.spriteName;
    console.log(`Created sprite: ${spriteName}, waiting for init...`);

    // Wait for sprite initialization
    await new Promise((r) => setTimeout(r, 10_000));
    console.log("Sprite ready, starting tests");
  }, 90_000);

  afterAll(async () => {
    if (spriteName) {
      console.log(`Cleaning up sprite: ${spriteName}`);
      await client.deleteSprite(spriteName);
    }
  }, 30_000);

  test("step 1: install SSH server", async () => {
    console.log("\n=== Step 1: Install SSH server ===");
    const result = await execShell(`
      export DEBIAN_FRONTEND=noninteractive
      sudo apt-get update && sudo apt-get install -y openssh-server sudo
      sudo mkdir -p /run/sshd
    `);
    console.log("Exit code:", result.exitCode);
    console.log("Stdout:", result.stdout.slice(-500));
    if (result.stderr) console.log("Stderr:", result.stderr.slice(-500));
    expect(result.exitCode).toBe(0);
  }, 120_000);

  test("step 2: create coder user", async () => {
    console.log("\n=== Step 2: Create coder user ===");
    const result = await execShell(`
      sudo useradd -m -s /bin/bash -G sudo coder || true
      echo "coder:${TEST_PASSWORD}" | sudo chpasswd
      echo "coder ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/coder > /dev/null
    `);
    console.log("Exit code:", result.exitCode);
    console.log("Stdout:", result.stdout);
    if (result.stderr) console.log("Stderr:", result.stderr);
    expect(result.exitCode).toBe(0);
  }, 30_000);

  test("step 3: configure SSH", async () => {
    console.log("\n=== Step 3: Configure SSH ===");
    const result = await execShell(`
      sudo sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config
      sudo sed -i 's/PasswordAuthentication no/PasswordAuthentication yes/' /etc/ssh/sshd_config
      echo "PermitUserEnvironment yes" | sudo tee -a /etc/ssh/sshd_config > /dev/null
    `);
    console.log("Exit code:", result.exitCode);
    console.log("Stdout:", result.stdout);
    if (result.stderr) console.log("Stderr:", result.stderr);
    expect(result.exitCode).toBe(0);
  }, 30_000);

  test("step 4: install code-server", async () => {
    console.log("\n=== Step 4: Install code-server ===");
    const result = await execShell(`
      export DEBIAN_FRONTEND=noninteractive
      curl -fsSL https://code-server.dev/install.sh | sh
    `);
    console.log("Exit code:", result.exitCode);
    console.log("Stdout:", result.stdout.slice(-1000));
    if (result.stderr) console.log("Stderr:", result.stderr.slice(-500));
    expect(result.exitCode).toBe(0);
  }, 180_000);

  test("step 5: configure code-server", async () => {
    console.log("\n=== Step 5: Configure code-server ===");
    const result = await execShell(`
      sudo mkdir -p /home/coder/.config/code-server
      sudo tee /home/coder/.config/code-server/config.yaml > /dev/null << 'EOF'
bind-addr: 0.0.0.0:8080
auth: password
password: ${TEST_PASSWORD}
cert: false
EOF
      sudo chown -R coder:coder /home/coder/.config
    `);
    console.log("Exit code:", result.exitCode);
    console.log("Stdout:", result.stdout);
    if (result.stderr) console.log("Stderr:", result.stderr);
    expect(result.exitCode).toBe(0);
  }, 30_000);

  test("step 6: download box-agent", async () => {
    console.log("\n=== Step 6: Download box-agent ===");
    const binaryUrl =
      "https://github.com/grmkris/claude-vps/releases/latest/download/box-agent-linux-x64";

    const result = await execShell(`
      sudo curl -fsSL "${binaryUrl}" -o /usr/local/bin/box-agent
      sudo chmod +x /usr/local/bin/box-agent
    `);
    console.log("Exit code:", result.exitCode);
    console.log("Stdout:", result.stdout);
    if (result.stderr) console.log("Stderr:", result.stderr);

    expect(result.exitCode).toBe(0);
  }, 120_000);

  test("step 7: create inbox directory", async () => {
    console.log("\n=== Step 7: Create inbox directory ===");
    const result = await execShell(`
      sudo mkdir -p /home/coder/.inbox
      sudo chown -R coder:coder /home/coder/.inbox
    `);
    console.log("Exit code:", result.exitCode);
    console.log("Stdout:", result.stdout);
    if (result.stderr) console.log("Stderr:", result.stderr);
    expect(result.exitCode).toBe(0);
  }, 30_000);

  test("step 8: set environment variables", async () => {
    console.log("\n=== Step 8: Set environment variables ===");
    const envExports = Object.entries(TEST_ENV_VARS)
      .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
      .join("\n");

    const result = await execShell(`
      sudo tee -a /home/coder/.bashrc > /dev/null << 'ENVEOF'
# Box environment variables
${envExports}
ENVEOF
      sudo chown coder:coder /home/coder/.bashrc
    `);
    console.log("Exit code:", result.exitCode);
    console.log("Stdout:", result.stdout);
    if (result.stderr) console.log("Stderr:", result.stderr);
    expect(result.exitCode).toBe(0);
  }, 30_000);

  test("step 9: create systemd service", async () => {
    console.log("\n=== Step 9: Create systemd service ===");
    const result = await execShell(`
      sudo tee /etc/systemd/system/box-agent.service > /dev/null << 'EOF'
[Unit]
Description=Box Agent Service
After=network.target

[Service]
Type=simple
User=coder
WorkingDirectory=/home/coder
EnvironmentFile=/home/coder/.bashrc.env
ExecStart=/usr/local/bin/box-agent
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
    `);
    console.log("Exit code:", result.exitCode);
    console.log("Stdout:", result.stdout);
    if (result.stderr) console.log("Stderr:", result.stderr);
    expect(result.exitCode).toBe(0);
  }, 30_000);

  test("step 10: create env file for systemd", async () => {
    console.log("\n=== Step 10: Create env file ===");
    const envFile = Object.entries(TEST_ENV_VARS)
      .map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`)
      .join("\n");

    const result = await execShell(`
      sudo tee /home/coder/.bashrc.env > /dev/null << 'ENVEOF'
${envFile}
ENVEOF
      sudo chown coder:coder /home/coder/.bashrc.env
    `);
    console.log("Exit code:", result.exitCode);
    console.log("Stdout:", result.stdout);
    if (result.stderr) console.log("Stderr:", result.stderr);
    expect(result.exitCode).toBe(0);
  }, 30_000);

  test("step 11: start services (no systemd - direct execution)", async () => {
    console.log("\n=== Step 11: Start services ===");
    const result = await execShell(`
      # Start SSH server
      sudo /usr/sbin/sshd

      # Start box-agent as coder user (nohup to survive shell exit)
      sudo -u coder bash -c 'cd /home/coder && source /home/coder/.bashrc.env && nohup /usr/local/bin/box-agent > /home/coder/.box-agent.log 2>&1 &' || echo "box-agent start failed (expected with placeholder)"

      # Start code-server as coder user
      sudo -u coder bash -c 'nohup code-server --config /home/coder/.config/code-server/config.yaml > /home/coder/.code-server.log 2>&1 &'

      # Give services a moment to start
      sleep 1
      echo "Services started"
    `);
    console.log("Exit code:", result.exitCode);
    console.log("Stdout:", result.stdout);
    if (result.stderr) console.log("Stderr:", result.stderr);
    expect(result.exitCode).toBe(0);
  }, 60_000);

  test("verify: check installed components", async () => {
    console.log("\n=== Verification ===");

    const checks = await execShell(`
      echo "=== SSH ==="
      which sshd && echo "sshd: OK" || echo "sshd: MISSING"

      echo "=== coder user ==="
      id coder && echo "coder user: OK" || echo "coder user: MISSING"

      echo "=== code-server ==="
      which code-server && echo "code-server: OK" || echo "code-server: MISSING"

      echo "=== box-agent ==="
      ls -la /usr/local/bin/box-agent && echo "box-agent: OK" || echo "box-agent: MISSING"

      echo "=== inbox ==="
      sudo ls -la /home/coder/.inbox && echo "inbox: OK" || echo "inbox: MISSING"

      echo "=== env file ==="
      sudo cat /home/coder/.bashrc.env
    `);
    console.log(checks.stdout);
    if (checks.stderr) console.log("Stderr:", checks.stderr);
  }, 30_000);
});

/**
 * Full setupSprite end-to-end test
 * Creates a fresh sprite and runs the actual setupSprite() method
 * to validate all 13 steps complete without hanging.
 *
 * Run with: SPRITES_TOKEN=xxx bun test packages/sprites/src/__tests__/setup-sprite.integration.test.ts --test-name-pattern "full setupSprite"
 */
describe.skipIf(!SPRITES_TOKEN)("setupSprite E2E", () => {
  let client: SpritesClient;
  let spriteName: string;
  let spriteUrl: string;

  const TEST_PASSWORD = "testpass123";
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
    console.log("Running all 13 setup steps via setupSprite()...\n");

    const startTime = Date.now();

    await client.setupSprite({
      spriteName,
      boxAgentBinaryUrl:
        "https://github.com/grmkris/claude-vps/releases/latest/download/box-agent-linux-x64",
      envVars: TEST_ENV_VARS,
      password: TEST_PASSWORD,
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
      echo "code-server: $(pgrep -f code-server > /dev/null && echo 'running' || echo 'not running')"
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
      echo ""
      echo "--- code-server ---"
      tail -10 /.sprite/logs/services/code-server.log 2>/dev/null || echo "No log"
    `);
    console.log(serviceLogs.stdout);

    // Assertions
    expect(checks.stdout).toContain("box-agent: running");
    expect(checks.stdout).toContain("nginx: running");
  }, 600_000); // 10 min timeout
});
