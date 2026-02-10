import type { Logger } from "@vps-claude/logger";

import type { ComputeProvider } from "../provider.interface";
import type {
  CreateInstanceConfig,
  ExecResult,
  FileInfo,
  FsListOptions,
  FsReadOptions,
  FsWriteOptions,
  InstanceInfo,
  InstanceResult,
  ProviderCapabilities,
  ProviderType,
  SetupStepConfig,
} from "../types";

import { createDockerClient, type DockerClient } from "./docker-client";
import { generateTraefikLabels, getContainerUrl } from "./traefik-labels";

// Base Docker image for boxes (multi-arch: amd64 + arm64)
// Use local image for dev, GHCR for prod
const BOX_IMAGE =
  process.env.BOX_IMAGE || "ghcr.io/grmkris/vps-claude-box:latest";

/**
 * Nginx config for Docker containers - static landing page only.
 * Traefik handles routing to services:
 *   /         → nginx:8080 (landing page)
 *   /app/*    → AgentApp:33003 (strip /app)
 *   /box/*    → BoxAgent:33002 (strip /box)
 */
const NGINX_CONFIG = `events {
    worker_connections 1024;
}

http {
    include mime.types;
    default_type application/octet-stream;

    server {
        listen 8080;
        root /var/www/html;
        index index.html;

        location / {
            try_files $uri $uri/ =404;
        }
    }
}`;

// Label prefix for our managed containers
const LABEL_PREFIX = "vps-claude";

// Home directory for box user
const HOME_DIR = "/home/box";

export interface DockerProviderOptions {
  /** Docker socket path or host URL */
  socketPath?: string;
  host?: string;
  port?: number;
  /** Base domain for routing (e.g., agents.example.com) */
  baseDomain: string;
  /** Enable TLS with Let's Encrypt (default: false for local dev) */
  useTls?: boolean;
  /** Logger instance */
  logger: Logger;
}

/**
 * DockerProvider - runs boxes as Docker containers
 *
 * Key differences from Sprites:
 * - No checkpoints, sleep/wake, or wsProxy
 * - Uses Traefik for routing
 * - Filesystem via docker cp
 * - SSH via sshpiper bastion
 */
export function createDockerProvider(
  options: DockerProviderOptions
): ComputeProvider {
  const {
    socketPath,
    host,
    port,
    baseDomain,
    useTls = false,
    logger,
  } = options;

  const dockerClient: DockerClient = createDockerClient({
    socketPath,
    host,
    port,
    logger,
  });

  // Instance URL cache (since we can't easily look up URL from container)
  const urlCache = new Map<string, string>();

  const provider: ComputeProvider = {
    type: "docker" as ProviderType,

    capabilities: {
      checkpoints: false,
      sleepWake: false,
      wsProxy: false,
      urlAuth: false,
      envHotReload: true,
    } satisfies ProviderCapabilities,

    // =========================================================================
    // Lifecycle
    // =========================================================================

    async createInstance(
      config: CreateInstanceConfig
    ): Promise<InstanceResult> {
      const instanceName = generateInstanceName(
        config.userId,
        config.subdomain
      );

      logger.info(
        { instanceName, subdomain: config.subdomain },
        "DockerProvider: Creating instance"
      );

      // Check if already exists
      const existing = await dockerClient.getContainer(instanceName);
      if (existing) {
        const url = getContainerUrl(config.subdomain, baseDomain, useTls);
        urlCache.set(instanceName, url);
        logger.info(
          { instanceName },
          "DockerProvider: Container already exists"
        );
        return { instanceName, url };
      }

      // Generate Traefik labels for path-based routing:
      // / -> BoxAgent (landing), /app/* -> AgentApp, /box/* -> BoxAgent
      const labels = generateTraefikLabels({
        serviceName: instanceName,
        subdomain: config.subdomain,
        baseDomain,
        useTls,
      });

      // Add our management labels
      labels[`${LABEL_PREFIX}.managed`] = "true";
      labels[`${LABEL_PREFIX}.user-id`] = config.userId;
      labels[`${LABEL_PREFIX}.subdomain`] = config.subdomain;

      // Convert env vars to array format, add Docker-specific vars
      // Include all config.envVars (BOX_AGENT_SECRET, etc.) plus Docker-specific overrides
      const dockerEnvVars = {
        ...config.envVars,
        APP_ENV: "prod", // Compiled binaries can't use pino-pretty transport
        BOX_DB_PATH: `${HOME_DIR}/.box-agent/sessions.db`,
        BOX_INBOX_DIR: `${HOME_DIR}/.inbox`,
        INSTANCE_NAME: instanceName, // For Docker exec command display
        // Ensure BOX_AGENT_SECRET is available for supervisor %(ENV_*)s expansion
        BOX_AGENT_SECRET: config.envVars.BOX_AGENT_SECRET,
      };
      const envArray = Object.entries(dockerEnvVars).map(
        ([k, v]) => `${k}=${v}`
      );

      await dockerClient.createContainer(instanceName, BOX_IMAGE, {
        Labels: labels,
        Env: envArray,
        HostConfig: {
          RestartPolicy: { Name: "unless-stopped" },
          Memory: 2 * 1024 * 1024 * 1024, // 2GB
          NanoCpus: 2 * 1e9, // 2 CPUs
          NetworkMode: "traefik", // Connect to traefik network for routing
        },
        // Image is multi-arch, no platform override needed
        // Keep container running - entrypoint starts supervisor
        Tty: true,
        OpenStdin: true,
        User: "root",
        WorkingDir: HOME_DIR,
      });

      // Base image already has: bun, claude-code, nginx, supervisor, box user
      // Just ensure directories exist (should be in image but safe to verify)
      logger.info(
        { instanceName },
        "DockerProvider: Verifying container setup"
      );
      await dockerClient.execShell(
        instanceName,
        `mkdir -p ${HOME_DIR}/.inbox ${HOME_DIR}/.box-agent ${HOME_DIR}/.claude/skills && chown -R box:box ${HOME_DIR}`
      );

      const url = getContainerUrl(config.subdomain, baseDomain, useTls);
      urlCache.set(instanceName, url);

      return { instanceName, url };
    },

    async deleteInstance(instanceName: string): Promise<void> {
      logger.info({ instanceName }, "DockerProvider: Deleting instance");
      await dockerClient.deleteContainer(instanceName);
      urlCache.delete(instanceName);
    },

    async getInstance(instanceName: string): Promise<InstanceInfo | null> {
      const container = await dockerClient.getContainer(instanceName);
      if (!container) return null;

      const info = await container.inspect();

      return {
        name: instanceName,
        status: mapContainerState(info.State?.Status ?? "unknown"),
        createdAt: info.Created,
      };
    },

    async listInstances(): Promise<InstanceInfo[]> {
      const containers = await dockerClient.listContainers(
        `${LABEL_PREFIX}.managed=true`
      );

      return containers.map((c) => ({
        name: c.Names?.[0]?.replace(/^\//, "") ?? "",
        status: mapContainerState(c.State ?? "unknown"),
        createdAt: new Date(c.Created * 1000).toISOString(),
      }));
    },

    // =========================================================================
    // Command Execution
    // =========================================================================

    async execCommand(
      instanceName: string,
      command: string
    ): Promise<ExecResult> {
      // Split command into args for non-shell execution
      const args = command.split(/\s+/);
      return dockerClient.exec(instanceName, args, { user: "box" });
    },

    async execShell(
      instanceName: string,
      command: string
    ): Promise<ExecResult> {
      return dockerClient.execShell(instanceName, command, { user: "box" });
    },

    // =========================================================================
    // Filesystem
    // =========================================================================

    async readFile(
      instanceName: string,
      path: string,
      _opts?: FsReadOptions
    ): Promise<Buffer> {
      return dockerClient.readFile(instanceName, path);
    },

    async writeFile(
      instanceName: string,
      path: string,
      content: Buffer | string,
      opts?: FsWriteOptions
    ): Promise<void> {
      // Create parent directory if requested
      if (opts?.mkdir) {
        const dir = path.substring(0, path.lastIndexOf("/"));
        if (dir) {
          await dockerClient.execShell(instanceName, `mkdir -p "${dir}"`);
        }
      }

      await dockerClient.writeFile(instanceName, path, content);

      // Set mode if specified
      if (opts?.mode) {
        await dockerClient.execShell(
          instanceName,
          `chmod ${opts.mode} "${path}"`
        );
      }
    },

    async listDir(
      instanceName: string,
      path: string,
      _opts?: FsListOptions
    ): Promise<FileInfo[]> {
      return dockerClient.listDir(instanceName, path);
    },

    // =========================================================================
    // Setup & Health
    // =========================================================================

    async runSetupStep(config: SetupStepConfig): Promise<ExecResult> {
      const {
        instanceName,
        stepKey,
        boxAgentBinaryUrl,
        envVars,
        instanceUrl,
        mcpServers,
      } = config;

      logger.info(
        { instanceName, stepKey },
        "DockerProvider: Running setup step"
      );

      const cmd = getDockerSetupCommand(stepKey, {
        boxAgentBinaryUrl,
        envVars,
        instanceUrl,
        mcpServers,
      });

      if (!cmd) {
        throw new Error(`Unknown setup step: ${stepKey}`);
      }

      const result = await dockerClient.execShell(instanceName, cmd, {
        user: "root",
      });

      if (result.exitCode !== 0) {
        throw new Error(
          `Setup step ${stepKey} failed with exit code ${result.exitCode}:\n` +
            `stdout: ${result.stdout}\n` +
            `stderr: ${result.stderr}`
        );
      }

      return result;
    },

    async checkHealth(
      instanceName: string,
      instanceUrl: string
    ): Promise<boolean> {
      // Check box-agent health via Traefik /box/* route (strips /box → /health)
      try {
        const res = await fetch(`${instanceUrl}/box/health`, {
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
          logger.warn(
            { instanceName, status: res.status },
            "DockerProvider: BoxAgent health check failed"
          );
          return false;
        }
      } catch (error) {
        logger.warn(
          { instanceName, error: String(error) },
          "DockerProvider: BoxAgent health check failed"
        );
        return false;
      }

      // Check agent-app via Traefik /app/* route (strips /app → /)
      try {
        const res = await fetch(`${instanceUrl}/app/`, {
          signal: AbortSignal.timeout(10000),
        });
        if (res.status >= 500) {
          logger.warn(
            { instanceName, status: res.status },
            "DockerProvider: AgentApp health check failed"
          );
          return false;
        }
      } catch (error) {
        logger.warn(
          { instanceName, error: String(error) },
          "DockerProvider: AgentApp health check failed"
        );
        return false;
      }

      logger.info({ instanceName }, "DockerProvider: Health check passed");
      return true;
    },

    async updateEnvVars(
      instanceName: string,
      envVars: Record<string, string>
    ): Promise<void> {
      // Read existing env file
      let existingVars: Record<string, string> = {};
      try {
        const content = await dockerClient.readFile(
          instanceName,
          `${HOME_DIR}/.bashrc.env`
        );
        for (const line of content.toString().split("\n")) {
          const match = line.match(/^export\s+([A-Z_][A-Z0-9_]*)="(.*)"/);
          if (match?.[1] !== undefined && match[2] !== undefined) {
            existingVars[match[1]] = match[2];
          }
        }
      } catch {
        // File doesn't exist, start fresh
      }

      // Merge with new vars
      const mergedVars = { ...existingVars, ...envVars };
      const envContent = Object.entries(mergedVars)
        .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
        .join("\n");

      await dockerClient.writeFile(
        instanceName,
        `${HOME_DIR}/.bashrc.env`,
        envContent
      );

      // Restart box-agent via supervisor to pick up new env vars
      // Supervisor config sources .bashrc.env before starting box-agent
      await dockerClient.execShell(
        instanceName,
        "supervisorctl restart box-agent",
        { user: "root" }
      );
    },

    // =========================================================================
    // Networking
    // =========================================================================

    getPublicUrl(instanceName: string): string | null {
      return urlCache.get(instanceName) ?? null;
    },
  };

  return provider;
}

/**
 * Generate unique instance name from userId and subdomain
 */
function generateInstanceName(userId: string, subdomain: string): string {
  return `${userId}-${subdomain}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/--+/g, "-")
    .slice(0, 63);
}

/**
 * Map Docker container state to our InstanceStatus
 */
function mapContainerState(
  state: string
): "creating" | "running" | "sleeping" | "stopped" | "error" {
  switch (state.toLowerCase()) {
    case "running":
      return "running";
    case "created":
    case "restarting":
      return "creating";
    case "paused":
      return "sleeping";
    case "exited":
    case "dead":
      return "stopped";
    default:
      return "error";
  }
}

/**
 * Get the shell command for a Docker setup step
 * Adapted from Sprites setup for Docker environment
 */
function getDockerSetupCommand(
  stepKey: string,
  config: {
    boxAgentBinaryUrl: string;
    envVars: Record<string, string>;
    instanceUrl: string;
    mcpServers?: Record<string, unknown>;
  }
): string {
  // Add Docker-specific env vars needed by box-agent
  const allEnvVars = {
    ...config.envVars,
    BOX_DB_PATH: `${HOME_DIR}/.box-agent/sessions.db`,
    BOX_INBOX_DIR: `${HOME_DIR}/.inbox`,
  };

  const envExports = Object.entries(allEnvVars)
    .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
    .join("\n");

  const envFileContent = Object.entries(allEnvVars)
    .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
    .join("\n");

  const commands: Record<string, string> = {
    // Base deps already installed in image
    SETUP_BASE_DEPS: `
      echo "Base dependencies pre-installed in box image"
    `,

    SETUP_DOWNLOAD_AGENT: `
      # Skip download if binary already exists (baked into image)
      if [ -f /usr/local/bin/box-agent ]; then
        echo "box-agent already present, skipping download"
      else
        curl -fsSL "${config.boxAgentBinaryUrl}" -o /usr/local/bin/box-agent
        chmod +x /usr/local/bin/box-agent
      fi
    `,

    SETUP_CREATE_DIRS: `
      mkdir -p ${HOME_DIR}/.inbox ${HOME_DIR}/.box-agent ${HOME_DIR}/.claude/skills/email-templates
      chown -R box:box ${HOME_DIR}
    `,

    SETUP_EMAIL_SKILL: `
      cat > ${HOME_DIR}/.claude/skills/email-templates/SKILL.md << 'SKILLEOF'
# Email Templates Skill

Send beautifully formatted emails using markdown.

## Quick Send

Use the \`email_send\` MCP tool with:
- **to**: recipient email address
- **subject**: email subject line
- **body**: markdown content (auto-converted to HTML)
SKILLEOF
      chown -R box:box ${HOME_DIR}/.claude
    `,

    SETUP_ENV_VARS: `
      cat >> ${HOME_DIR}/.bashrc << 'ENVEOF'
# Box environment variables
${envExports}
ENVEOF
      chown box:box ${HOME_DIR}/.bashrc
    `,

    SETUP_CREATE_ENV_FILE: `
      cat > ${HOME_DIR}/.bashrc.env << 'ENVEOF'
${envFileContent}
ENVEOF
      chown box:box ${HOME_DIR}/.bashrc.env
      # Source env vars in zsh so docker exec gets them
      grep -q 'bashrc.env' ${HOME_DIR}/.zshrc 2>/dev/null || echo '[ -f ~/.bashrc.env ] && source ~/.bashrc.env' >> ${HOME_DIR}/.zshrc
    `,

    SETUP_BOX_AGENT_SERVICE: `
      cat > /etc/supervisor/conf.d/box-agent.conf << 'SUPERVISOREOF'
[program:box-agent]
command=/bin/bash -c "source /home/box/.bashrc.env && exec /usr/local/bin/box-agent"
directory=/home/box
user=box
environment=HOME="/home/box"
autostart=true
autorestart=true
stderr_logfile=/var/log/box-agent.err.log
stdout_logfile=/var/log/box-agent.out.log
SUPERVISOREOF
      # Wait for supervisord socket (entrypoint may still be downloading box-agent)
      for i in $(seq 1 30); do [ -S /var/run/supervisor.sock ] && break; sleep 1; done
      supervisorctl reread
      supervisorctl update
    `,

    SETUP_INSTALL_NGINX: `
      # Create static landing page directory
      mkdir -p /var/www/html

      # Create landing page HTML (env vars substituted at runtime via envsubst)
      cat > /tmp/landing.html << 'HTMLEOF'
<!DOCTYPE html>
<html>
<head>
  <title>Box: $BOX_SUBDOMAIN</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 2rem auto; padding: 0 1rem; color: #333; background: #fafafa; }
    h1 { border-bottom: 1px solid #ddd; padding-bottom: 0.5rem; }
    nav { display: flex; gap: 1rem; margin: 1rem 0; flex-wrap: wrap; }
    a { color: #0066cc; text-decoration: none; padding: 0.5rem 1rem; background: #fff; border: 1px solid #ddd; border-radius: 4px; }
    a:hover { background: #f0f0f0; }
    pre { background: #fff; padding: 1rem; border-radius: 4px; overflow-x: auto; font-size: 14px; border: 1px solid #ddd; }
    section { margin: 1.5rem 0; }
    h2 { font-size: 1.1rem; color: #555; }
  </style>
</head>
<body>
  <h1>Box: $BOX_SUBDOMAIN</h1>
  <nav>
    <a href="/app">App Dashboard</a>
    <a href="/box/rpc/">API Docs</a>
    <a href="/box/health">Health Check</a>
  </nav>
  <section>
    <h2>Docker Access</h2>
    <div style="position: relative;">
      <pre id="docker-cmd">docker exec -it -u box $INSTANCE_NAME zsh</pre>
      <button onclick="navigator.clipboard.writeText(document.getElementById('docker-cmd').textContent).then(()=>{this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',1500)})"
        style="position: absolute; top: 0.5rem; right: 0.5rem; padding: 0.25rem 0.5rem; font-size: 12px; background: #f0f0f0; border: 1px solid #ddd; border-radius: 4px; cursor: pointer;">
        Copy
      </button>
    </div>
  </section>
</body>
</html>
HTMLEOF

      # Write full nginx config with reverse proxy
      cat > /etc/nginx/nginx.conf << 'NGINXEOF'
${NGINX_CONFIG}
NGINXEOF
    `,

    SETUP_NGINX_SERVICE: `
      # Generate landing page with env vars using sed (envsubst not always available)
      source /home/box/.bashrc.env
      cp /tmp/landing.html /var/www/html/index.html
      sed -i "s|\\$BOX_SUBDOMAIN|$BOX_SUBDOMAIN|g" /var/www/html/index.html
      sed -i "s|\\$INSTANCE_NAME|$INSTANCE_NAME|g" /var/www/html/index.html

      # Add nginx supervisor config
      cat > /etc/supervisor/conf.d/nginx.conf << 'SUPERVISOREOF'
[program:nginx]
command=/usr/sbin/nginx -g "daemon off;"
autostart=true
autorestart=true
stderr_logfile=/var/log/nginx.err.log
stdout_logfile=/var/log/nginx.out.log
SUPERVISOREOF
      # Wait for supervisord socket (entrypoint may still be downloading box-agent)
      for i in $(seq 1 30); do [ -S /var/run/supervisor.sock ] && break; sleep 1; done
      supervisorctl reread
      supervisorctl update
    `,

    SETUP_CLONE_AGENT_APP: `
      [ -d ${HOME_DIR}/agent-app ] || git clone https://github.com/grmkris/agent-next-app ${HOME_DIR}/agent-app
      chown -R box:box ${HOME_DIR}/agent-app
    `,

    SETUP_INSTALL_AGENT_APP: `
      cd ${HOME_DIR}/agent-app && sudo -u box /usr/local/bin/bun install
    `,

    SETUP_AGENT_APP_SERVICE: `
      cat > /etc/supervisor/conf.d/agent-app.conf << 'SUPERVISOREOF'
[program:agent-app]
command=/bin/bash -c "source /home/box/.bashrc.env && cd /home/box/agent-app && export DATABASE_URL=file:/home/box/agent-app/local.db && export BETTER_AUTH_SECRET=\\$BOX_AGENT_SECRET && exec /usr/local/bin/bun dev --port 33003"
directory=/home/box/agent-app
user=box
autostart=true
autorestart=true
stderr_logfile=/var/log/agent-app.err.log
stdout_logfile=/var/log/agent-app.out.log
SUPERVISOREOF
      # Wait for supervisord socket (entrypoint may still be downloading box-agent)
      for i in $(seq 1 30); do [ -S /var/run/supervisor.sock ] && break; sleep 1; done
      supervisorctl reread
      supervisorctl update
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
          return `su - box -c "claude mcp add -s user '${safeName}' -- ${cfg.command}${args ? ` ${args}` : ""}" || true`;
        }
        return `su - box -c "claude mcp add -s user -t ${transport} '${safeName}' '${cfg.url}'" || true`;
      });
      return cmds.join("\n");
    })(),

    SETUP_INSTALL_CLAUDE: `
      # Claude CLI pre-installed in box image, verify it exists
      which claude || curl -fsSL https://claude.ai/install.sh | sudo -u box bash
    `,

    SETUP_TAILSCALE: `
      echo "Tailscale skipped for Docker provider"
    `,
  };

  return commands[stepKey] ?? "";
}
