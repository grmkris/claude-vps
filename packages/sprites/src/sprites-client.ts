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
}

export function createSpritesClient(
  options: SpritesClientOptions
): SpritesClient {
  const { token } = options;
  const flyClient = new FlySpritesClient(token);

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
    const sprite = await flyClient.createSprite(spriteName);

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
    const sprites = await flyClient.listAllSprites();
    return sprites.map((s) => ({ name: s.name }));
  }

  async function deleteSprite(spriteName: string): Promise<void> {
    await flyClient.deleteSprite(spriteName);
  }

  async function getSprite(spriteName: string): Promise<SpriteInfo | null> {
    try {
      const sprite = await flyClient.getSprite(spriteName);
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
    const sprite = flyClient.sprite(spriteName);
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

  async function createCheckpoint(spriteName: string): Promise<Checkpoint> {
    const sprite = flyClient.sprite(spriteName);
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
    const sprite = flyClient.sprite(spriteName);
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
    const sprite = flyClient.sprite(spriteName);
    const response = await sprite.restoreCheckpoint(checkpointId);

    // Consume the streaming response to wait for completion
    await response.text();
  }

  /**
   * Set up a sprite with SSH, code-server, and box-agent
   * This runs after createSprite to install all required services
   */
  async function setupSprite(config: SpriteSetupConfig): Promise<void> {
    const { spriteName, password, boxAgentBinaryUrl, envVars } = config;

    // Step 1: Install SSH server
    await execCommand(
      spriteName,
      `
      apt-get update && apt-get install -y openssh-server sudo
      mkdir -p /run/sshd
    `
    );

    // Step 2: Create coder user with password
    await execCommand(
      spriteName,
      `
      useradd -m -s /bin/bash -G sudo coder || true
      echo "coder:${password}" | chpasswd
      echo "coder ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/coder
    `
    );

    // Step 3: Configure SSH
    await execCommand(
      spriteName,
      `
      sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config
      sed -i 's/PasswordAuthentication no/PasswordAuthentication yes/' /etc/ssh/sshd_config
      echo "PermitUserEnvironment yes" >> /etc/ssh/sshd_config
    `
    );

    // Step 4: Install code-server
    await execCommand(
      spriteName,
      `
      curl -fsSL https://code-server.dev/install.sh | sh
    `
    );

    // Step 5: Configure code-server
    await execCommand(
      spriteName,
      `
      mkdir -p /home/coder/.config/code-server
      cat > /home/coder/.config/code-server/config.yaml << 'EOF'
bind-addr: 0.0.0.0:8080
auth: password
password: ${password}
cert: false
EOF
      chown -R coder:coder /home/coder/.config
    `
    );

    // Step 6: Download and install box-agent binary
    await execCommand(
      spriteName,
      `
      curl -fsSL "${boxAgentBinaryUrl}" -o /usr/local/bin/box-agent
      chmod +x /usr/local/bin/box-agent
    `
    );

    // Step 7: Create inbox directory
    await execCommand(
      spriteName,
      `
      mkdir -p /home/coder/.inbox
      chown -R coder:coder /home/coder/.inbox
    `
    );

    // Step 8: Set environment variables for coder user
    const envExports = Object.entries(envVars)
      .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
      .join("\n");

    await execCommand(
      spriteName,
      `
      cat >> /home/coder/.bashrc << 'ENVEOF'
# Box environment variables
${envExports}
ENVEOF
      chown coder:coder /home/coder/.bashrc
    `
    );

    // Step 9: Create systemd service for box-agent (runs as coder)
    await execCommand(
      spriteName,
      `
      cat > /etc/systemd/system/box-agent.service << 'EOF'
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
    `
    );

    // Step 10: Create env file for systemd
    const envFile = Object.entries(envVars)
      .map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`)
      .join("\n");

    await execCommand(
      spriteName,
      `
      cat > /home/coder/.bashrc.env << 'ENVEOF'
${envFile}
ENVEOF
      chown coder:coder /home/coder/.bashrc.env
    `
    );

    // Step 11: Start services
    await execCommand(
      spriteName,
      `
      /usr/sbin/sshd
      systemctl daemon-reload
      systemctl enable box-agent
      systemctl start box-agent
      su - coder -c "code-server &"
    `
    );
  }

  /**
   * Get the WebSocket proxy URL for a sprite
   */
  function getProxyUrl(spriteName: string): string {
    // Use baseURL from SDK, converting https:// to wss://
    const wsBase = flyClient.baseURL.replace(/^https?:\/\//, "wss://");
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
      `${flyClient.baseURL}/v1/sprites/${encodeURIComponent(spriteName)}/fs/read`
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
      `${flyClient.baseURL}/v1/sprites/${encodeURIComponent(spriteName)}/fs/write`
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
      `${flyClient.baseURL}/v1/sprites/${encodeURIComponent(spriteName)}/fs/list`
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

  return {
    createSprite,
    listSprites,
    deleteSprite,
    getSprite,
    execCommand,
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
  };
}
