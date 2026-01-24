import { z } from "zod";

import type {
  Checkpoint,
  CreateSpriteConfig,
  ExecResult,
  SpriteInfo,
  SpriteSetupConfig,
  SpritesClient,
} from "./types";

const API_BASE = "https://api.sprites.dev/v1";

// Runtime validation for exec response
const ExecResponseSchema = z.object({
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  exit_code: z.number().optional(),
});

export interface SpritesClientOptions {
  token: string;
}

export function createSpritesClient(
  options: SpritesClientOptions
): SpritesClient {
  const { token } = options;

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  async function apiRequest<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text().catch(() => "Unknown error");
      throw new Error(`Sprites API error (${response.status}): ${error}`);
    }

    // Handle empty responses (204 No Content)
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

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

    // Create the sprite
    await apiRequest("POST", "/sprites", { name: spriteName });

    // Set environment variables via exec
    // Write to /etc/environment for persistence across sessions
    const envLines = Object.entries(config.envVars)
      .map(([key, value]) => `${key}="${value.replace(/"/g, '\\"')}"`)
      .join("\n");

    if (envLines) {
      await execCommand(
        spriteName,
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
    const result = await apiRequest<{ sprites: Array<{ name: string }> }>(
      "GET",
      "/sprites"
    );
    return result.sprites || [];
  }

  async function deleteSprite(spriteName: string): Promise<void> {
    await apiRequest("DELETE", `/sprites/${encodeURIComponent(spriteName)}`);
  }

  async function getSprite(spriteName: string): Promise<SpriteInfo | null> {
    try {
      return await apiRequest<SpriteInfo>(
        "GET",
        `/sprites/${encodeURIComponent(spriteName)}`
      );
    } catch (error) {
      if (String(error).includes("404")) {
        return null;
      }
      throw error;
    }
  }

  async function execCommand(
    spriteName: string,
    command: string
  ): Promise<ExecResult> {
    // Use POST /sprites/{name}/exec with cmd query param
    // This is a simplified sync exec - for streaming use WebSocket
    const url = new URL(
      `${API_BASE}/sprites/${encodeURIComponent(spriteName)}/exec`
    );
    url.searchParams.set("cmd", command);

    const response = await fetch(url.toString(), {
      method: "POST",
      headers,
    });

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(
        `Exec failed (${response.status}): ${responseText || "Unknown error"}`
      );
    }

    // Try to parse as JSON first (structured response)
    try {
      const json: unknown = JSON.parse(responseText);
      const result = ExecResponseSchema.parse(json);
      return {
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        exitCode: result.exit_code ?? 0,
      };
    } catch {
      // Not JSON - treat as plain text stdout
      return {
        stdout: responseText,
        stderr: "",
        exitCode: 0,
      };
    }
  }

  async function createCheckpoint(spriteName: string): Promise<Checkpoint> {
    return apiRequest<Checkpoint>(
      "POST",
      `/sprites/${encodeURIComponent(spriteName)}/checkpoints`
    );
  }

  async function listCheckpoints(spriteName: string): Promise<Checkpoint[]> {
    const result = await apiRequest<{ checkpoints: Checkpoint[] }>(
      "GET",
      `/sprites/${encodeURIComponent(spriteName)}/checkpoints`
    );
    return result.checkpoints || [];
  }

  async function restoreCheckpoint(
    spriteName: string,
    checkpointId: string
  ): Promise<void> {
    await apiRequest(
      "POST",
      `/sprites/${encodeURIComponent(spriteName)}/checkpoints/${encodeURIComponent(checkpointId)}/restore`
    );
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
    return `wss://api.sprites.dev/v1/sprites/${encodeURIComponent(spriteName)}/proxy`;
  }

  /**
   * Get the API token (for proxy authentication)
   */
  function getToken(): string {
    return token;
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
  };
}
