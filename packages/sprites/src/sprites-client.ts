import type { Logger } from "@vps-claude/logger";

import { SpritesClient as FlySpritesClient } from "@fly/sprites";

/**
 * Embedded nginx config for sprite reverse proxy.
 * Routes:
 *   /code/*   → code-server :8443 (VS Code IDE)
 *   /email/*  → box-agent :9999 (email webhooks)
 *   /agent/*  → box-agent :9999 (agent API)
 *   /health   → box-agent :9999 (health check)
 *   /*        → agent-app :3000 (Next.js user app)
 */
const NGINX_CONFIG = `events {
    worker_connections 1024;
}

http {
    include mime.types;
    default_type application/octet-stream;
    sendfile on;
    keepalive_timeout 65;

    access_log /var/log/nginx/access.log;
    error_log /var/log/nginx/error.log;

    upstream box_agent {
        server 127.0.0.1:9999;
        keepalive 8;
    }

    upstream agent_app {
        server 127.0.0.1:3000;
        keepalive 8;
    }

    upstream code_server {
        server 127.0.0.1:8443;
        keepalive 8;
    }

    server {
        listen 8080;
        server_name _;

        proxy_buffer_size 128k;
        proxy_buffers 4 256k;
        proxy_busy_buffers_size 256k;

        location /email/ {
            proxy_pass http://box_agent;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_read_timeout 120s;
            proxy_connect_timeout 10s;
        }

        location /agent/ {
            proxy_pass http://box_agent;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_read_timeout 300s;
            proxy_connect_timeout 10s;
        }

        location /health {
            proxy_pass http://box_agent;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_connect_timeout 5s;
            proxy_read_timeout 5s;
        }

        location /code/ {
            proxy_pass http://code_server/;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_cache_bypass $http_upgrade;
            proxy_read_timeout 86400s;
            proxy_connect_timeout 10s;
        }

        location / {
            proxy_pass http://agent_app;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_cache_bypass $http_upgrade;
            proxy_read_timeout 60s;
            proxy_connect_timeout 10s;
        }

        location /_next/static/ {
            proxy_pass http://agent_app;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            expires 1y;
            add_header Cache-Control "public, immutable";
        }

        error_page 502 503 504 /50x.html;
        location = /50x.html {
            root /usr/share/nginx/html;
            internal;
        }
    }
}`;

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
   * Set up a sprite with all services:
   * - box-agent (email handling, Claude sessions) on port 9999
   * - nginx (reverse proxy on port 8080) - HTTP entry point
   * - agent-app (Next.js app on port 3000)
   * - code-server (VS Code IDE on port 8443)
   *
   * This runs after createSprite to configure the full service stack.
   * Uses sprite-env services for persistent service management.
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

    // Step 1: Download and install box-agent binary
    await runStep(
      1,
      "Download box-agent",
      `
      curl -fsSL "${boxAgentBinaryUrl}" -o /usr/local/bin/box-agent
      chmod +x /usr/local/bin/box-agent
    `
    );

    // Step 2: Create data directories
    await runStep(
      2,
      "Create directories",
      `
      mkdir -p /home/sprite/.inbox /home/sprite/.box-agent
    `
    );

    // Step 3: Set environment variables for sprite user
    const envExports = Object.entries(finalEnvVars)
      .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
      .join("\n");

    await runStep(
      3,
      "Set env vars",
      `
      tee -a /home/sprite/.bashrc > /dev/null << 'ENVEOF'
# Box environment variables
${envExports}
ENVEOF
    `
    );

    // Step 4: Create env file for box-agent
    await runStep(
      4,
      "Create env file",
      `
      tee /home/sprite/.bashrc.env > /dev/null << 'ENVEOF'
${Object.entries(finalEnvVars)
  .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
  .join("\n")}
ENVEOF
    `
    );

    // Step 5: Create box-agent wrapper script and service
    // Using a wrapper script to properly load environment variables
    await runStep(
      5,
      "Create box-agent service",
      `
      cat > /home/sprite/start-box-agent.sh << 'STARTEOF'
#!/bin/bash
source /home/sprite/.bashrc.env
exec /usr/local/bin/box-agent
STARTEOF
      chmod +x /home/sprite/start-box-agent.sh

      sprite-env services create box-agent \\
        --cmd /home/sprite/start-box-agent.sh \\
        --dir /home/sprite \\
        --no-stream
    `
    );

    // Step 6: Install nginx
    await runStep(
      6,
      "Install nginx",
      `
      apt-get update && apt-get install -y nginx
    `
    );

    // Step 7: Configure nginx and create service (HTTP entry point)
    await writeFile(spriteName, "/etc/nginx/nginx.conf", NGINX_CONFIG);
    await runStep(
      7,
      "Create nginx service",
      `
      nginx -t

      # Wrapper script to run nginx in foreground
      cat > /usr/local/bin/start-nginx.sh << 'NGINXEOF'
#!/bin/bash
exec /usr/sbin/nginx -g "daemon off;"
NGINXEOF
      chmod +x /usr/local/bin/start-nginx.sh

      sprite-env services create nginx \\
        --cmd /usr/local/bin/start-nginx.sh \\
        --http-port 8080 \\
        --no-stream
    `
    );

    // Step 8: Clone agent-next-app (to sprite user home for service access)
    await runStep(
      8,
      "Clone agent-app",
      `
      git clone https://github.com/grmkris/agent-next-app /home/sprite/agent-app
    `
    );

    // Step 9: Install agent-app dependencies
    await runStep(
      9,
      "Install agent-app",
      `
      cd /home/sprite/agent-app && /.sprite/bin/bun install
    `
    );

    // Step 10: Create agent-app service (dev mode)
    await runStep(
      10,
      "Create agent-app service",
      `
      cat > /home/sprite/start-agent-app.sh << 'STARTEOF'
#!/bin/bash
source /home/sprite/.bashrc.env 2>/dev/null || true
cd /home/sprite/agent-app
# TODO: Make DATABASE_URL configurable via box settings
export DATABASE_URL="file:/home/sprite/agent-app/local.db"
exec /.sprite/bin/bun dev
STARTEOF
      chmod +x /home/sprite/start-agent-app.sh

      sprite-env services create agent-app \\
        --cmd /home/sprite/start-agent-app.sh \\
        --needs box-agent \\
        --no-stream
    `
    );

    // Step 11: Install and configure code-server
    const codeServerPassword = password || "changeme";
    await runStep(
      11,
      "Install code-server",
      `
      curl -fsSL https://code-server.dev/install.sh | sh
      mkdir -p /home/sprite/.config/code-server
      tee /home/sprite/.config/code-server/config.yaml > /dev/null << 'CODESERVEOF'
bind-addr: 127.0.0.1:8443
auth: password
password: ${codeServerPassword}
cert: false
CODESERVEOF
    `
    );

    // Step 12: Create code-server service
    await runStep(
      12,
      "Create code-server service",
      `
      cat > /home/sprite/start-code-server.sh << 'CODEEOF'
#!/bin/bash
exec /usr/bin/code-server --config /home/sprite/.config/code-server/config.yaml /home/sprite/agent-app
CODEEOF
      chmod +x /home/sprite/start-code-server.sh

      sprite-env services create code-server \\
        --cmd /home/sprite/start-code-server.sh \\
        --no-stream
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
      "cat /home/sprite/.bashrc.env 2>/dev/null || echo ''"
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
      `cat > /home/sprite/.bashrc.env << 'ENVEOF'
${envFile}
ENVEOF
sprite-env services restart box-agent`
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
