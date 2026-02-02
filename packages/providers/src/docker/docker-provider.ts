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

// Base Docker image for boxes
const BOX_IMAGE = "ubuntu:22.04";

// Label prefix for our managed containers
const LABEL_PREFIX = "vps-claude";

// Home directory for box user
const HOME_DIR = "/home/coder";

export interface DockerProviderOptions {
  /** Docker socket path or host URL */
  socketPath?: string;
  host?: string;
  port?: number;
  /** Base domain for routing (e.g., agents.example.com) */
  baseDomain: string;
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
  const { socketPath, host, port, baseDomain, logger } = options;

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
        const url = getContainerUrl(config.subdomain, baseDomain);
        urlCache.set(instanceName, url);
        logger.info(
          { instanceName },
          "DockerProvider: Container already exists"
        );
        return { instanceName, url };
      }

      // Generate Traefik labels
      const labels = generateTraefikLabels({
        serviceName: instanceName,
        subdomain: config.subdomain,
        baseDomain,
      });

      // Add our management labels
      labels[`${LABEL_PREFIX}.managed`] = "true";
      labels[`${LABEL_PREFIX}.user-id`] = config.userId;
      labels[`${LABEL_PREFIX}.subdomain`] = config.subdomain;

      // Convert env vars to array format
      const envArray = Object.entries(config.envVars).map(
        ([k, v]) => `${k}=${v}`
      );

      await dockerClient.createContainer(instanceName, BOX_IMAGE, {
        Labels: labels,
        Env: envArray,
        HostConfig: {
          // Keep container running
          RestartPolicy: { Name: "unless-stopped" },
          // Resource limits
          Memory: 2 * 1024 * 1024 * 1024, // 2GB
          NanoCpus: 2 * 1e9, // 2 CPUs
        },
        // Keep container running with a long-running process
        Cmd: ["/bin/bash", "-c", "while true; do sleep 3600; done"],
        Tty: true,
        OpenStdin: true,
        User: "root",
        // Use "/" initially - HOME_DIR doesn't exist in base image yet
        WorkingDir: "/",
      });

      // Create coder user and home directory
      await dockerClient.execShell(
        instanceName,
        `
        useradd -m -s /bin/bash coder || true
        mkdir -p ${HOME_DIR}
        chown -R coder:coder ${HOME_DIR}
      `
      );

      const url = getContainerUrl(config.subdomain, baseDomain);
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
      return dockerClient.exec(instanceName, args, { user: "coder" });
    },

    async execShell(
      instanceName: string,
      command: string
    ): Promise<ExecResult> {
      return dockerClient.execShell(instanceName, command, { user: "coder" });
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
      const { instanceName, stepKey, boxAgentBinaryUrl, envVars, instanceUrl } =
        config;

      logger.info(
        { instanceName, stepKey },
        "DockerProvider: Running setup step"
      );

      const cmd = getDockerSetupCommand(stepKey, {
        boxAgentBinaryUrl,
        envVars,
        instanceUrl,
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
      // Check box-agent health endpoint
      try {
        const res = await fetch(`${instanceUrl}/health`, {
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
          logger.warn(
            { instanceName, status: res.status },
            "DockerProvider: Health check failed"
          );
          return false;
        }
      } catch (error) {
        logger.warn(
          { instanceName, error: String(error) },
          "DockerProvider: Health check failed"
        );
        return false;
      }

      // Check agent-app
      try {
        const res = await fetch(`${instanceUrl}/`, {
          signal: AbortSignal.timeout(10000),
        });
        if (res.status >= 500) {
          logger.warn(
            { instanceName, status: res.status },
            "DockerProvider: Agent-app health check failed"
          );
          return false;
        }
      } catch (error) {
        logger.warn(
          { instanceName, error: String(error) },
          "DockerProvider: Agent-app health check failed"
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

      // Restart box-agent to pick up changes
      await dockerClient.execShell(
        instanceName,
        "pkill -f box-agent || true; nohup /usr/local/bin/box-agent > /var/log/box-agent.log 2>&1 &"
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
  }
): string {
  const envExports = Object.entries(config.envVars)
    .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
    .join("\n");

  const envFileContent = Object.entries(config.envVars)
    .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
    .join("\n");

  const commands: Record<string, string> = {
    // Install base dependencies
    SETUP_BASE_DEPS: `
      apt-get update
      apt-get install -y curl git nginx supervisor
      curl -fsSL https://bun.sh/install | bash
      mv /root/.bun/bin/bun /usr/local/bin/bun
    `,

    SETUP_DOWNLOAD_AGENT: `
      curl -fsSL "${config.boxAgentBinaryUrl}" -o /usr/local/bin/box-agent
      chmod +x /usr/local/bin/box-agent
    `,

    SETUP_CREATE_DIRS: `
      mkdir -p ${HOME_DIR}/.inbox ${HOME_DIR}/.box-agent ${HOME_DIR}/.claude/skills/email-templates
      chown -R coder:coder ${HOME_DIR}
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
      chown -R coder:coder ${HOME_DIR}/.claude
    `,

    SETUP_ENV_VARS: `
      cat >> ${HOME_DIR}/.bashrc << 'ENVEOF'
# Box environment variables
${envExports}
ENVEOF
      chown coder:coder ${HOME_DIR}/.bashrc
    `,

    SETUP_CREATE_ENV_FILE: `
      cat > ${HOME_DIR}/.bashrc.env << 'ENVEOF'
${envFileContent}
ENVEOF
      chown coder:coder ${HOME_DIR}/.bashrc.env
    `,

    SETUP_BOX_AGENT_SERVICE: `
      cat > /etc/supervisor/conf.d/box-agent.conf << 'SUPERVISOREOF'
[program:box-agent]
command=/bin/bash -c "source ${HOME_DIR}/.bashrc.env && exec /usr/local/bin/box-agent"
directory=${HOME_DIR}
user=coder
autostart=true
autorestart=true
stderr_logfile=/var/log/box-agent.err.log
stdout_logfile=/var/log/box-agent.out.log
SUPERVISOREOF
      supervisorctl reread
      supervisorctl update
    `,

    SETUP_INSTALL_NGINX: `
      # nginx installed in SETUP_BASE_DEPS
      echo "nginx already installed"
    `,

    SETUP_NGINX_SERVICE: `
      cat > /etc/nginx/nginx.conf << 'NGINXEOF'
events {
    worker_connections 1024;
}

http {
    include mime.types;
    default_type application/octet-stream;
    sendfile on;
    keepalive_timeout 65;

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

        location /email/ {
            proxy_pass http://box_agent;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }

        location /agent/ {
            proxy_pass http://box_agent;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
        }

        location /health {
            proxy_pass http://box_agent;
            proxy_http_version 1.1;
        }

        location / {
            proxy_pass http://agent_app;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
        }
    }
}
NGINXEOF
      nginx -t
      supervisorctl restart nginx || supervisorctl start nginx
    `,

    SETUP_CLONE_AGENT_APP: `
      [ -d ${HOME_DIR}/agent-app ] || git clone https://github.com/grmkris/agent-next-app ${HOME_DIR}/agent-app
      chown -R coder:coder ${HOME_DIR}/agent-app
    `,

    SETUP_INSTALL_AGENT_APP: `
      cd ${HOME_DIR}/agent-app && sudo -u coder /usr/local/bin/bun install
    `,

    SETUP_AGENT_APP_SERVICE: `
      cat > /etc/supervisor/conf.d/agent-app.conf << 'SUPERVISOREOF'
[program:agent-app]
command=/bin/bash -c "source ${HOME_DIR}/.bashrc.env && cd ${HOME_DIR}/agent-app && export DATABASE_URL=file:${HOME_DIR}/agent-app/local.db && export BETTER_AUTH_SECRET=%(ENV_BOX_AGENT_SECRET)s && exec /usr/local/bin/bun dev --port 3000"
directory=${HOME_DIR}/agent-app
user=coder
autostart=true
autorestart=true
stderr_logfile=/var/log/agent-app.err.log
stdout_logfile=/var/log/agent-app.out.log
environment=BOX_AGENT_SECRET="${config.envVars.BOX_AGENT_SECRET ?? ""}"
SUPERVISOREOF
      supervisorctl reread
      supervisorctl update
    `,

    SETUP_MCP_SETTINGS: `
      source ${HOME_DIR}/.bashrc.env
      ${HOME_DIR}/.local/bin/claude mcp add -s user -t http ai-tools http://localhost:33002/mcp
    `,
  };

  return commands[stepKey] ?? "";
}
