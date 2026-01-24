import type { Logger } from "@vps-claude/logger";

import { SpritesClient as FlySpritesClient } from "@fly/sprites";

import type {
  Checkpoint,
  CreateSpriteConfig,
  ExecResult,
  FileInfo,
  FsListOptions,
  FsReadOptions,
  FsWriteOptions,
  SpriteInfo,
  SpriteSetupConfig,
  SpritesClient,
} from "./types";

export interface SpritesClientOptions {
  token: string;
  logger: Logger;
}

export function createSpritesClient(
  options: SpritesClientOptions
): SpritesClient {
  const { token, logger } = options;
  const flySpritesClient = new FlySpritesClient(token);

  /**
   * Generate unique sprite name from userId and subdomain
   * Format: {userId}-{subdomain} (sanitized for Sprites naming rules)
   */
  function generateSpriteName(userId: string, subdomain: string): string {
    // Sprites names: lowercase letters, numbers, hyphens
    // Max length likely 63 chars (DNS label limit)
    const sanitized = `${userId}-${subdomain}`
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/--+/g, "-")
      .slice(0, 63);
    return sanitized;
  }

  async function createSprite(
    config: CreateSpriteConfig
  ): Promise<{ spriteName: string; url: string }> {
    const spriteName = generateSpriteName(config.userId, config.subdomain);

    // Create the sprite using official SDK
    const sprite = await flySpritesClient.createSprite(spriteName);

    // Set environment variables via exec
    // Write to ~/.bashrc for persistence across sessions
    if (Object.keys(config.envVars).length > 0) {
      await sprite.exec(
        `cat >> ~/.bashrc << 'ENVEOF'
# Box environment variables
${Object.entries(config.envVars)
  .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
  .join("\n")}
ENVEOF`
      );
    }

    return {
      spriteName,
      url: `https://${spriteName}.sprites.dev`,
    };
  }

  async function listSprites(): Promise<Array<{ name: string }>> {
    const sprites = await flySpritesClient.listAllSprites();
    return sprites.map((s) => ({ name: s.name }));
  }

  async function deleteSprite(spriteName: string): Promise<void> {
    await flySpritesClient.deleteSprite(spriteName);
  }

  async function getSprite(spriteName: string): Promise<SpriteInfo | null> {
    try {
      const sprite = await flySpritesClient.getSprite(spriteName);
      // Map SDK type to our type
      return {
        name: sprite.name,
        status: mapSpriteStatus(sprite.status),
        created_at: sprite.createdAt?.toISOString(),
        updated_at: sprite.updatedAt?.toISOString(),
      };
    } catch (error) {
      // SDK throws on 404
      if (
        String(error).includes("404") ||
        String(error).includes("not found")
      ) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Map SDK status to our status enum
   */
  function mapSpriteStatus(
    sdkStatus?: string
  ): "running" | "sleeping" | "stopped" | "creating" | "error" {
    switch (sdkStatus?.toLowerCase()) {
      case "running":
        return "running";
      case "sleeping":
      case "suspended":
        return "sleeping";
      case "stopped":
        return "stopped";
      case "creating":
      case "pending":
        return "creating";
      default:
        return "error";
    }
  }

  async function execCommand(
    spriteName: string,
    command: string
  ): Promise<ExecResult> {
    const sprite = flySpritesClient.sprite(spriteName);
    const result = await sprite.exec(command);

    return {
      stdout:
        typeof result.stdout === "string"
          ? result.stdout
          : result.stdout.toString("utf8"),
      stderr:
        typeof result.stderr === "string"
          ? result.stderr
          : result.stderr.toString("utf8"),
      exitCode: result.exitCode,
    };
  }

  /**
   * Execute a shell command with proper bash interpretation
   * Sprites exec() runs commands directly without a shell, so shell syntax
   * (heredocs, redirects, pipes, export) requires a workaround.
   *
   * Strategy: Write script to temp file via filesystem API, then execute it
   */
  async function execShell(
    spriteName: string,
    command: string
  ): Promise<ExecResult> {
    const scriptPath = `/tmp/exec-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`;

    // Write the script to a temp file via filesystem API
    await writeFile(spriteName, scriptPath, `#!/bin/bash\nset -e\n${command}`);

    // Execute the script (no shell syntax needed - just command + arg)
    const result = await execCommand(spriteName, `/bin/bash ${scriptPath}`);

    // Best effort cleanup (ignore errors)
    try {
      await execCommand(spriteName, `/bin/rm ${scriptPath}`);
    } catch {
      // Ignore cleanup errors
    }

    return result;
  }

  async function createCheckpoint(spriteName: string): Promise<Checkpoint> {
    const sprite = flySpritesClient.sprite(spriteName);
    const response = await sprite.createCheckpoint();

    // The SDK returns a streaming Response, we need to consume it
    // and extract the checkpoint info from the NDJSON stream
    const text = await response.text();
    const lines = text.trim().split("\n").filter(Boolean);
    const lastLine = lines[lines.length - 1];

    if (lastLine) {
      const data = JSON.parse(lastLine) as {
        id?: string;
        create_time?: string;
      };
      return {
        id: data.id || `checkpoint-${Date.now()}`,
        sprite_name: spriteName,
        created_at: data.create_time || new Date().toISOString(),
      };
    }

    // Fallback
    return {
      id: `checkpoint-${Date.now()}`,
      sprite_name: spriteName,
      created_at: new Date().toISOString(),
    };
  }

  async function listCheckpoints(spriteName: string): Promise<Checkpoint[]> {
    const sprite = flySpritesClient.sprite(spriteName);
    const sdkCheckpoints = await sprite.listCheckpoints();

    return sdkCheckpoints.map((cp) => ({
      id: cp.id,
      sprite_name: spriteName,
      created_at: cp.createTime.toISOString(),
    }));
  }

  async function restoreCheckpoint(
    spriteName: string,
    checkpointId: string
  ): Promise<void> {
    const sprite = flySpritesClient.sprite(spriteName);
    const response = await sprite.restoreCheckpoint(checkpointId);

    // Consume the streaming response to wait for completion
    await response.text();
  }

  /**
   * Set up a sprite with box-agent
   * This runs after createSprite to install the agent service
   * Sprites handles its own auth (private by default, token-based access)
   *
   * Uses execShell() for all commands since they require shell syntax
   * (heredocs, redirects, pipes, export, etc.)
   */
  async function setupSprite(config: SpriteSetupConfig): Promise<void> {
    const { spriteName, boxAgentBinaryUrl, envVars, password } = config;

    // Add PASSWORD to envVars for code-server if provided
    const finalEnvVars = password
      ? { ...envVars, PASSWORD: password }
      : envVars;

    // Helper to run a setup step with error context
    async function runStep(stepNum: number, name: string, cmd: string) {
      logger.info({ spriteName, step: stepNum }, `Setup: ${name}`);
      const result = await execShell(spriteName, cmd);
      if (result.exitCode !== 0) {
        throw new Error(
          `Setup step ${stepNum} (${name}) failed with exit code ${result.exitCode}:\n` +
            `stdout: ${result.stdout}\n` +
            `stderr: ${result.stderr}`
        );
      }
      return result;
    }

    // Step 1: Create coder user with optional password for code-server
    await runStep(
      1,
      "Create coder user",
      `
      sudo useradd -m -s /bin/bash -G sudo coder || true
      echo "coder ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/coder > /dev/null
      ${password ? `echo "coder:${password.replace(/"/g, '\\"')}" | sudo chpasswd` : ""}
    `
    );

    // Step 2: Download and install box-agent binary
    await runStep(
      2,
      "Download box-agent",
      `
      sudo curl -fsSL "${boxAgentBinaryUrl}" -o /usr/local/bin/box-agent
      sudo chmod +x /usr/local/bin/box-agent
    `
    );

    // Step 3: Create data directories
    await runStep(
      3,
      "Create directories",
      `
      sudo mkdir -p /home/coder/.inbox /home/coder/.box-agent
      sudo chown -R coder:coder /home/coder/.inbox /home/coder/.box-agent
    `
    );

    // Step 4: Set environment variables for coder user
    const envExports = Object.entries(finalEnvVars)
      .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
      .join("\n");

    await runStep(
      4,
      "Set env vars",
      `
      sudo tee -a /home/coder/.bashrc > /dev/null << 'ENVEOF'
# Box environment variables
${envExports}
ENVEOF
      sudo chown coder:coder /home/coder/.bashrc
    `
    );

    // Step 5: Create env file for box-agent
    const envFile = Object.entries(finalEnvVars)
      .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
      .join("\n");

    await runStep(
      5,
      "Create env file",
      `
      sudo tee /home/coder/.bashrc.env > /dev/null << 'ENVEOF'
${envFile}
ENVEOF
      sudo chown coder:coder /home/coder/.bashrc.env
    `
    );

    // Step 6: Start box-agent
    await runStep(
      6,
      "Start box-agent",
      `
      # Start box-agent as coder user (nohup to survive shell exit)
      sudo -u coder bash -c 'cd /home/coder && source /home/coder/.bashrc.env && nohup /usr/local/bin/box-agent > /home/coder/.box-agent.log 2>&1 &'

      # Give service a moment to start
      sleep 1
    `
    );
  }

  /**
   * Get the WebSocket proxy URL for a sprite
   */
  function getProxyUrl(spriteName: string): string {
    // Use baseURL from SDK, converting https:// to wss://
    const wsBase = flySpritesClient.baseURL.replace(/^https?:\/\//, "wss://");
    return `${wsBase}/v1/sprites/${encodeURIComponent(spriteName)}/proxy`;
  }

  /**
   * Get the API token (for proxy authentication)
   */
  function getToken(): string {
    return token;
  }

  /**
   * Update environment variables on a running sprite without full redeploy
   * Updates .bashrc.env and restarts box-agent to pick up changes
   */
  async function updateEnvVars(
    spriteName: string,
    envVars: Record<string, string>
  ): Promise<void> {
    // Read existing env file, merge with new vars
    const existingResult = await execCommand(
      spriteName,
      "cat /home/coder/.bashrc.env 2>/dev/null || echo ''"
    );

    // Parse existing vars
    const existingVars: Record<string, string> = {};
    for (const line of existingResult.stdout.split("\n")) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)="(.*)"/);
      if (match?.[1] !== undefined && match[2] !== undefined) {
        existingVars[match[1]] = match[2];
      }
    }

    // Merge with new vars (new vars override)
    const mergedVars = { ...existingVars, ...envVars };

    const envFile = Object.entries(mergedVars)
      .map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`)
      .join("\n");

    await execCommand(
      spriteName,
      `cat > /home/coder/.bashrc.env << 'ENVEOF'
${envFile}
ENVEOF
chown coder:coder /home/coder/.bashrc.env
systemctl restart box-agent`
    );
  }

  /**
   * Read file contents from a sprite via filesystem API
   */
  async function readFile(
    spriteName: string,
    path: string,
    opts?: FsReadOptions
  ): Promise<Buffer> {
    const url = new URL(
      `${flySpritesClient.baseURL}/v1/sprites/${encodeURIComponent(spriteName)}/fs/read`
    );
    url.searchParams.set("path", path);
    if (opts?.workingDir) url.searchParams.set("workingDir", opts.workingDir);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`readFile failed: ${res.status} ${await res.text()}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  /**
   * Write file to a sprite via filesystem API
   */
  async function writeFile(
    spriteName: string,
    path: string,
    content: Buffer | string,
    opts?: FsWriteOptions
  ): Promise<void> {
    const url = new URL(
      `${flySpritesClient.baseURL}/v1/sprites/${encodeURIComponent(spriteName)}/fs/write`
    );
    url.searchParams.set("path", path);
    if (opts?.workingDir) url.searchParams.set("workingDir", opts.workingDir);
    if (opts?.mode) url.searchParams.set("mode", opts.mode);
    if (opts?.mkdir) url.searchParams.set("mkdir", "true");

    const res = await fetch(url.toString(), {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: typeof content === "string" ? content : new Uint8Array(content),
    });
    if (!res.ok) {
      throw new Error(`writeFile failed: ${res.status} ${await res.text()}`);
    }
  }

  /**
   * List directory contents on a sprite via filesystem API
   */
  async function listDir(
    spriteName: string,
    path: string,
    opts?: FsListOptions
  ): Promise<FileInfo[]> {
    const url = new URL(
      `${flySpritesClient.baseURL}/v1/sprites/${encodeURIComponent(spriteName)}/fs/list`
    );
    url.searchParams.set("path", path);
    if (opts?.workingDir) url.searchParams.set("workingDir", opts.workingDir);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`listDir failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { entries: FileInfo[] };
    return data.entries;
  }

  /**
   * Set URL auth mode for a sprite
   * SDK v0.0.1 doesn't have updateURLSettings, so we use direct API call
   */
  async function setUrlAuth(
    spriteName: string,
    auth: "public" | "sprite"
  ): Promise<void> {
    const res = await fetch(
      `${flySpritesClient.baseURL}/v1/sprites/${encodeURIComponent(spriteName)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url_settings: { auth } }),
      }
    );
    if (!res.ok) {
      throw new Error(`setUrlAuth failed: ${res.status} ${await res.text()}`);
    }
  }

  return {
    createSprite,
    listSprites,
    deleteSprite,
    getSprite,
    execCommand,
    execShell,
    setupSprite,
    createCheckpoint,
    listCheckpoints,
    restoreCheckpoint,
    getProxyUrl,
    getToken,
    updateEnvVars,
    readFile,
    writeFile,
    listDir,
    setUrlAuth,
  };
}
