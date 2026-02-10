import type { Logger } from "@vps-claude/logger";

import { SpritesClient as FlySpritesClient } from "@fly/sprites";

/**
 * Embedded nginx config for sprite reverse proxy.
 * Routes:
 *   /email/*  → box-agent :33002 (email webhooks)
 *   /agent/*  → box-agent :33002 (agent API)
 *   /health   → box-agent :33002 (health check)
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
        server 127.0.0.1:33002;
        keepalive 8;
    }

    upstream agent_app {
        server 127.0.0.1:3000;
        keepalive 8;
    }

    server {
        listen 8080;
        server_name _;

        proxy_buffer_size 128k;
        proxy_buffers 4 256k;
        proxy_busy_buffers_size 256k;

        location /rpc/ {
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

import {
  SETUP_STEP_KEYS,
  type Checkpoint,
  type CreateSpriteConfig,
  type ExecResult,
  type FileInfo,
  type FsListOptions,
  type FsReadOptions,
  type FsWriteOptions,
  type SpriteInfo,
  type SpriteSetupConfig,
  type SpritesClient,
  type SetupStepConfig,
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

    // Check if sprite already exists (idempotent for retry scenarios)
    const existingSprite = await flySpritesClient
      .getSprite(spriteName)
      .catch(() => null);
    if (existingSprite) {
      logger.info({ spriteName }, "Sprite already exists, reusing");
      return {
        spriteName,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        url: (existingSprite as any).url as string,
      };
    }

    // Create the sprite using official SDK
    await flySpritesClient.createSprite(spriteName);

    // Set environment variables via shell (requires bash for heredoc)
    // Write to ~/.bashrc for persistence across sessions
    if (Object.keys(config.envVars).length > 0) {
      await execShell(
        spriteName,
        `cat >> ~/.bashrc << 'ENVEOF'
# Box environment variables
${Object.entries(config.envVars)
  .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
  .join("\n")}
ENVEOF`
      );
    }

    // Fetch full sprite info to get the URL (createSprite doesn't return it)
    const spriteInfo = await flySpritesClient.getSprite(spriteName);

    return {
      spriteName,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      url: (spriteInfo as any).url as string,
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
      // SDK throws on 404 or 500 (Sprites API returns 500 for non-existent sprites)
      if (
        String(error).includes("404") ||
        String(error).includes("500") ||
        String(error).includes("not found") ||
        String(error).includes("failed to retrieve sprite")
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
    try {
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
    } catch (error) {
      // ExecError is thrown by @fly/sprites on non-zero exit codes
      // Extract stdout/stderr from the error result instead of losing context
      if (error && typeof error === "object" && "result" in error) {
        const execError = error as {
          result: {
            stdout: Buffer | string;
            stderr: Buffer | string;
            exitCode: number;
          };
        };
        return {
          stdout:
            typeof execError.result.stdout === "string"
              ? execError.result.stdout
              : execError.result.stdout.toString("utf8"),
          stderr:
            typeof execError.result.stderr === "string"
              ? execError.result.stderr
              : execError.result.stderr.toString("utf8"),
          exitCode: execError.result.exitCode,
        };
      }
      throw error;
    }
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
   * Get the shell command for a specific setup step
   */
  function getStepCommand(
    stepKey: string,
    config: {
      boxAgentBinaryUrl: string;
      envVars: Record<string, string>;
      spriteUrl: string;
      mcpServers?: Record<string, unknown>;
    }
  ): string {
    const envFileContent = [
      ...Object.entries(config.envVars).map(
        ([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`
      ),
      // Add PATH with custom bin directories for SSH access
      'export PATH="/home/sprite/.local/bin:/.sprite/languages/bun/bin:${PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}"',
    ].join("\n");

    const commands: Record<string, string> = {
      SETUP_DOWNLOAD_AGENT: `
        curl -fsSL "${config.boxAgentBinaryUrl}" -o /usr/local/bin/box-agent
        chmod +x /usr/local/bin/box-agent
      `,
      SETUP_CREATE_DIRS: `
        mkdir -p /home/sprite/.inbox /home/sprite/.box-agent /home/sprite/.claude/skills/email-templates
      `,
      SETUP_EMAIL_SKILL: `
        cat > /home/sprite/.claude/skills/email-templates/SKILL.md << 'SKILLEOF'
# Email Templates Skill

Send beautifully formatted emails using markdown.

## Quick Send

Use the \`email_send\` MCP tool with:
- **to**: recipient email address
- **subject**: email subject line
- **body**: markdown content (auto-converted to HTML)

## Markdown Formatting

Your email body supports full markdown:

- **Bold**: \`**text**\`
- *Italic*: \`*text*\`
- Lists: \`- item\` or \`1. item\`
- Links: \`[text](url)\`
- Headers: \`# H1\`, \`## H2\`, \`### H3\`
- Code: \\\`inline\\\` or fenced blocks
- Blockquotes: \`> quoted text\`

## Example: Professional Reply

\`\`\`json
{
  "to": "john@example.com",
  "subject": "Re: Project Update",
  "body": "Hi John,\\n\\nThank you for the update. Here are my thoughts:\\n\\n## Key Points\\n\\n1. **Timeline** looks good\\n2. *Budget* needs review\\n3. Next steps:\\n   - Schedule call\\n   - Review docs\\n\\nBest regards"
}
\`\`\`

## Tips

- Keep subject lines concise
- Use headers to organize longer emails
- Include clear calls-to-action
- The email will be rendered as styled HTML
SKILLEOF
      `,
      SETUP_ENV_VARS: `
        # Source env file from bashrc (single source of truth)
        grep -q '.bashrc.env' /home/sprite/.bashrc 2>/dev/null || \
          echo 'source /home/sprite/.bashrc.env 2>/dev/null || true' >> /home/sprite/.bashrc

        # Also add to .profile for login shells
        grep -q '.bashrc.env' /home/sprite/.profile 2>/dev/null || \
          echo 'source /home/sprite/.bashrc.env 2>/dev/null || true' >> /home/sprite/.profile
      `,
      SETUP_CREATE_ENV_FILE: `
        tee /home/sprite/.bashrc.env > /dev/null << 'ENVEOF'
${envFileContent}
ENVEOF
      `,
      SETUP_INSTALL_CLAUDE: `
        # Install Claude Code CLI globally using bun
        source /home/sprite/.bashrc.env
        /.sprite/bin/bun add -g @anthropic-ai/claude-code

        # Verify installation
        /.sprite/bin/claude --version || echo "Claude CLI installed"
      `,
      SETUP_BOX_AGENT_SERVICE: `
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
      `,
      SETUP_INSTALL_NGINX: `
        sudo apt-get update && sudo apt-get install -y nginx
      `,
      SETUP_NGINX_SERVICE: `
        sudo nginx -t

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
      `,
      SETUP_CLONE_AGENT_APP: `
        [ -d /home/sprite/agent-app ] || git clone https://github.com/grmkris/agent-next-app /home/sprite/agent-app
      `,
      SETUP_INSTALL_AGENT_APP: `
        cd /home/sprite/agent-app && /.sprite/bin/bun install
      `,
      SETUP_AGENT_APP_SERVICE: `
        cat > /home/sprite/start-agent-app.sh << 'STARTEOF'
#!/bin/bash
source /home/sprite/.bashrc.env 2>/dev/null || true
cd /home/sprite/agent-app
export DATABASE_URL="file:/home/sprite/agent-app/local.db"
export BETTER_AUTH_SECRET="${config.envVars.BOX_AGENT_SECRET}"
exec /.sprite/bin/bun dev --port 3000
STARTEOF
        chmod +x /home/sprite/start-agent-app.sh

        # Remove existing service if present (idempotent)
        sprite-env services remove agent-app 2>/dev/null || true
        sprite-env services create agent-app \\
          --cmd /home/sprite/start-agent-app.sh \\
          --needs box-agent \\
          --no-stream
      `,
      SETUP_MCP_SETTINGS: (() => {
        const allServers: Record<string, Record<string, unknown>> = {
          "ai-tools": { type: "http", url: "http://localhost:33002/mcp" },
        };
        if (config.mcpServers) {
          for (const [name, mcpConfig] of Object.entries(config.mcpServers)) {
            if (name !== "ai-tools") {
              allServers[name] = mcpConfig as Record<string, unknown>;
            }
          }
        }
        const sanitize = (n: string) => n.replace(/[^a-zA-Z0-9_-]/g, "-");
        const cmds = Object.entries(allServers).map(([name, cfg]) => {
          const safeName = sanitize(name);
          const transport =
            cfg.type === "sse" ? "sse" : cfg.type === "http" ? "http" : "stdio";
          if (transport === "stdio") {
            const args = Array.isArray(cfg.args)
              ? (cfg.args as string[]).join(" ")
              : "";
            return `claude mcp add -s user '${safeName}' -- ${cfg.command}${args ? ` ${args}` : ""} || true`;
          }
          return `claude mcp add -s user -t ${transport} '${safeName}' '${cfg.url}' || true`;
        });
        return cmds.join("\n");
      })(),
      SETUP_TAILSCALE: `
        set -euo pipefail
        source /home/sprite/.bashrc.env

        # Skip if no auth key provided
        if [ -z "\${TAILSCALE_AUTHKEY:-}" ]; then
          echo "Skipping Tailscale: TAILSCALE_AUTHKEY not set"
          exit 0
        fi

        # Install via apt (safer than curl | sh)
        curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/jammy.noarmor.gpg | sudo tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null
        curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/jammy.tailscale-keyring.list | sudo tee /etc/apt/sources.list.d/tailscale.list >/dev/null
        sudo apt-get update -qq && sudo apt-get install -y -qq tailscale

        # Create wrapper script for tailscaled daemon
        cat > /usr/local/bin/start-tailscaled.sh << 'TSEOF'
#!/bin/bash
exec /usr/sbin/tailscaled --state=/var/lib/tailscale/tailscaled.state --socket=/run/tailscale/tailscaled.sock
TSEOF
        chmod +x /usr/local/bin/start-tailscaled.sh
        sudo mkdir -p /var/lib/tailscale /run/tailscale

        # Register as sprite-env service
        sprite-env services remove tailscaled 2>/dev/null || true
        sprite-env services create tailscaled --cmd /usr/local/bin/start-tailscaled.sh --no-stream

        # Wait for daemon socket
        for i in {1..30}; do
          [ -S /run/tailscale/tailscaled.sock ] && break
          sleep 0.5
        done

        # Join network (--reset for idempotency on redeploys)
        sudo tailscale up --authkey="$TAILSCALE_AUTHKEY" --ssh --hostname="$BOX_SUBDOMAIN" --reset

        # Output IP in parseable format for capture
        echo "TAILSCALE_IP=$(tailscale ip -4)"
      `,
    };

    return commands[stepKey] ?? "";
  }

  /**
   * Run a single setup step by key
   * Used by modular deploy workers for fine-grained control
   */
  async function runSetupStep(config: SetupStepConfig): Promise<ExecResult> {
    const {
      spriteName,
      stepKey,
      boxAgentBinaryUrl,
      envVars,
      spriteUrl,
      mcpServers,
    } = config;

    // Special case: SETUP_NGINX_SERVICE needs nginx config written first
    if (stepKey === "SETUP_NGINX_SERVICE") {
      await writeFile(spriteName, "/etc/nginx/nginx.conf", NGINX_CONFIG);
    }

    const cmd = getStepCommand(stepKey, {
      boxAgentBinaryUrl,
      envVars,
      spriteUrl,
      mcpServers,
    });

    if (!cmd) {
      throw new Error(`Unknown setup step: ${stepKey}`);
    }

    logger.info({ spriteName, stepKey }, `Running setup step: ${stepKey}`);
    const result = await execShell(spriteName, cmd);

    if (result.exitCode !== 0) {
      throw new Error(
        `Setup step ${stepKey} failed with exit code ${result.exitCode}:\n` +
          `stdout: ${result.stdout}\n` +
          `stderr: ${result.stderr}`
      );
    }

    return result;
  }

  /**
   * Check if services are healthy on the sprite
   * Verifies box-agent and nginx are responding
   */
  async function checkHealth(
    spriteName: string,
    spriteUrl: string
  ): Promise<boolean> {
    // Check 1: box-agent health endpoint via nginx proxy
    try {
      const res = await fetch(`${spriteUrl}/health`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        logger.warn(
          { spriteName, status: res.status },
          "Health check failed: box-agent unhealthy"
        );
        return false;
      }
    } catch (error) {
      logger.warn(
        { spriteName, error: String(error) },
        "Health check failed: could not reach box-agent"
      );
      return false;
    }

    // Check 2: agent-app via nginx proxy (check root returns something)
    try {
      const res = await fetch(`${spriteUrl}/`, {
        signal: AbortSignal.timeout(10000),
      });
      // Agent app might return 200 or redirect, either is fine
      if (res.status >= 500) {
        logger.warn(
          { spriteName, status: res.status },
          "Health check failed: agent-app error"
        );
        return false;
      }
    } catch (error) {
      logger.warn(
        { spriteName, error: String(error) },
        "Health check failed: could not reach agent-app"
      );
      return false;
    }

    logger.info({ spriteName }, "Health check passed");
    return true;
  }

  async function setupSprite(config: SpriteSetupConfig): Promise<void> {
    const {
      spriteName,
      boxAgentBinaryUrl,
      envVars,
      spriteUrl: _spriteUrl,
      onProgress,
      resumeFromStep,
    } = config;

    async function runStep(stepNum: number, name: string, cmd: string) {
      const stepKey = SETUP_STEP_KEYS[stepNum - 1];

      if (resumeFromStep && stepNum < resumeFromStep) {
        logger.info(
          { spriteName, step: stepNum },
          `Skipping: ${name} (already completed)`
        );
        return { stdout: "", stderr: "", exitCode: 0 };
      }

      if (onProgress && stepKey) {
        await onProgress(stepKey, "start");
      }

      logger.info({ spriteName, step: stepNum }, `Setup: ${name}`);

      try {
        const result = await execShell(spriteName, cmd);
        if (result.exitCode !== 0) {
          const errorMsg =
            `Setup step ${stepNum} (${name}) failed with exit code ${result.exitCode}:\n` +
            `stdout: ${result.stdout}\n` +
            `stderr: ${result.stderr}`;

          if (onProgress && stepKey) {
            await onProgress(stepKey, "error", errorMsg);
          }

          throw new Error(errorMsg);
        }

        if (onProgress && stepKey) {
          await onProgress(stepKey, "complete");
        }

        return result;
      } catch (error) {
        if (
          onProgress &&
          stepKey &&
          !(error instanceof Error && error.message.includes("Setup step"))
        ) {
          await onProgress(
            stepKey,
            "error",
            error instanceof Error ? error.message : String(error)
          );
        }
        throw error;
      }
    }

    await runStep(
      1,
      "Download box-agent",
      `
      curl -fsSL "${boxAgentBinaryUrl}" -o /usr/local/bin/box-agent
      chmod +x /usr/local/bin/box-agent
    `
    );

    await runStep(
      2,
      "Create directories",
      `
      mkdir -p /home/sprite/.inbox /home/sprite/.box-agent /home/sprite/.claude/skills/email-templates
    `
    );

    await runStep(
      3,
      "Install email skill",
      `
      cat > /home/sprite/.claude/skills/email-templates/SKILL.md << 'SKILLEOF'
# Email Templates Skill

Send beautifully formatted emails using markdown.

## Quick Send

Use the \`email_send\` MCP tool with:
- **to**: recipient email address
- **subject**: email subject line
- **body**: markdown content (auto-converted to HTML)

## Markdown Formatting

Your email body supports full markdown:

- **Bold**: \`**text**\`
- *Italic*: \`*text*\`
- Lists: \`- item\` or \`1. item\`
- Links: \`[text](url)\`
- Headers: \`# H1\`, \`## H2\`, \`### H3\`
- Code: \\\`inline\\\` or fenced blocks
- Blockquotes: \`> quoted text\`

## Example: Professional Reply

\`\`\`json
{
  "to": "john@example.com",
  "subject": "Re: Project Update",
  "body": "Hi John,\\n\\nThank you for the update. Here are my thoughts:\\n\\n## Key Points\\n\\n1. **Timeline** looks good\\n2. *Budget* needs review\\n3. Next steps:\\n   - Schedule call\\n   - Review docs\\n\\nBest regards"
}
\`\`\`

## Tips

- Keep subject lines concise
- Use headers to organize longer emails
- Include clear calls-to-action
- The email will be rendered as styled HTML
SKILLEOF
    `
    );

    const envExports = Object.entries(envVars)
      .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
      .join("\n");

    await runStep(
      4,
      "Set env vars",
      `
      tee -a /home/sprite/.bashrc > /dev/null << 'ENVEOF'
# Box environment variables
${envExports}
ENVEOF
    `
    );

    await runStep(
      5,
      "Create env file",
      `
      tee /home/sprite/.bashrc.env > /dev/null << 'ENVEOF'
${Object.entries(envVars)
  .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
  .join("\n")}
ENVEOF
    `
    );

    await runStep(
      6,
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

    await runStep(
      7,
      "Install nginx",
      `
      sudo apt-get update && sudo apt-get install -y nginx
    `
    );

    await writeFile(spriteName, "/etc/nginx/nginx.conf", NGINX_CONFIG);
    await runStep(
      8,
      "Create nginx service",
      `
      sudo nginx -t

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

    await runStep(
      9,
      "Clone agent-app",
      `
      git clone https://github.com/grmkris/agent-next-app /home/sprite/agent-app
    `
    );

    await runStep(
      10,
      "Install agent-app",
      `
      cd /home/sprite/agent-app && /.sprite/bin/bun install
    `
    );

    await runStep(
      11,
      "Create agent-app service",
      `
      cat > /home/sprite/start-agent-app.sh << 'STARTEOF'
#!/bin/bash
source /home/sprite/.bashrc.env 2>/dev/null || true
cd /home/sprite/agent-app
export DATABASE_URL="file:/home/sprite/agent-app/local.db"
export BETTER_AUTH_SECRET="${envVars.BOX_AGENT_SECRET}"
exec /.sprite/bin/bun dev --port 3000
STARTEOF
      chmod +x /home/sprite/start-agent-app.sh

      sprite-env services create agent-app \\
        --cmd /home/sprite/start-agent-app.sh \\
        --needs box-agent \\
        --no-stream
    `
    );

    await runStep(
      12,
      "Configure MCP settings",
      `
      source /home/sprite/.bashrc.env
      /home/sprite/.local/bin/claude mcp add -s user -t http ai-tools http://localhost:33002/mcp
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

    // Parse existing vars (handles both "export KEY=" and "KEY=" formats)
    const existingVars: Record<string, string> = {};
    for (const line of existingResult.stdout.split("\n")) {
      const match = line.match(/^(?:export\s+)?([A-Z_][A-Z0-9_]*)="(.*)"/);
      if (match?.[1] !== undefined && match[2] !== undefined) {
        existingVars[match[1]] = match[2];
      }
    }

    // Merge with new vars (new vars override)
    const mergedVars = { ...existingVars, ...envVars };

    const envFile = Object.entries(mergedVars)
      .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
      .join("\n");

    await execShell(
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
    const data = (await res.json()) as { entries: FileInfo[] | null };
    return data.entries ?? [];
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
    runSetupStep,
    checkHealth,
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
