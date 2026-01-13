import Docker from "dockerode";
import fs from "node:fs/promises";

import { buildHardenedConfig } from "./container-config";
import {
  CreateBoxConfigSchema,
  type CreateBoxConfig,
  type BoxContainer,
  type BoxStats,
} from "./types";

export class DockerEngineClient {
  docker: Docker;
  agentsDomain?: string;
  baseDir: string;
  skipSeccomp: boolean;
  skipTraefik: boolean;
  skipHealthcheck: boolean;

  constructor(options?: {
    agentsDomain?: string;
    baseDir?: string;
    skipSeccomp?: boolean;
    skipTraefik?: boolean;
    skipHealthcheck?: boolean;
  }) {
    this.docker = new Docker({ socketPath: "/var/run/docker.sock" });
    this.agentsDomain = options?.agentsDomain;
    this.baseDir = options?.baseDir || "/mnt/devboxes";
    this.skipSeccomp = options?.skipSeccomp || false;
    this.skipTraefik = options?.skipTraefik || false;
    this.skipHealthcheck = options?.skipHealthcheck || false;
  }

  /**
   * Build Docker image from Dockerfile context
   */
  async buildImage(context: string, imageName: string): Promise<void> {
    const stream = await this.docker.buildImage(
      { context, src: ["Dockerfile"] },
      { t: imageName, rm: true, forcerm: true }
    );

    await new Promise((resolve, reject) => {
      this.docker.modem.followProgress(
        stream,
        (err: Error | null, res: unknown) => (err ? reject(err) : resolve(res))
      );
    });
  }

  /**
   * Create and start hardened box container
   */
  async createBox(config: CreateBoxConfig): Promise<BoxContainer> {
    // Validate input
    const validated = CreateBoxConfigSchema.parse(config);

    // Ensure host directories exist
    await this.ensureBoxDirectories(validated.userId, validated.boxId);

    // Create isolated network
    const networkName = `box-${validated.subdomain}-network`;
    try {
      await this.docker.createNetwork({
        Name: networkName,
        Driver: "bridge",
        Internal: false, // Allow internet access
        EnableIPv6: false,
      });
    } catch (err) {
      // Ignore if network already exists
      if (!String(err).includes("already exists")) throw err;
    }

    // Build container config with security hardening
    const containerConfig = buildHardenedConfig(
      validated,
      this.agentsDomain,
      this.baseDir,
      {
        skipSeccomp: this.skipSeccomp,
        skipHealthcheck: this.skipHealthcheck,
      }
    );

    // Create container
    const container = await this.docker.createContainer(containerConfig);

    // Connect to traefik network for HTTP routing
    if (!this.skipTraefik) {
      try {
        const traefikNetwork = this.docker.getNetwork("traefik-public");
        await traefikNetwork.connect({ Container: container.id });
      } catch (err) {
        console.warn("Traefik network not found or connection failed:", err);
      }
    }

    // Start container
    await container.start();

    // Wait a moment for container to initialize
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Get container info
    const info = await container.inspect();

    return {
      id: container.id,
      name: validated.name,
      subdomain: validated.subdomain,
      status: info.State.Running ? "running" : "stopped",
      ipAddress: info.NetworkSettings.Networks[networkName]?.IPAddress,
    };
  }

  /**
   * Stop and remove container, clean up resources
   */
  async deleteBox(
    containerId: string,
    userId: string,
    boxId: string
  ): Promise<void> {
    const container = this.docker.getContainer(containerId);

    let info;
    try {
      info = await container.inspect();
    } catch {
      // Container doesn't exist, just clean up directories
      await this.cleanupBoxDirectories(userId, boxId);
      return;
    }

    // Stop container (with 10s timeout)
    try {
      await container.stop({ t: 10 });
    } catch {
      // Already stopped
    }

    // Remove container
    await container.remove({ force: true });

    // Clean up networks
    const networks = Object.keys(info.NetworkSettings.Networks || {});
    for (const networkName of networks) {
      if (networkName.startsWith("box-")) {
        try {
          const network = this.docker.getNetwork(networkName);
          await network.remove();
        } catch {
          // Network might be in use or already deleted
        }
      }
    }

    // Clean up host directories (agent-specific only)
    await this.cleanupBoxDirectories(userId, boxId);
  }

  /**
   * Wait for container to become healthy
   */
  async waitForHealth(
    containerId: string,
    timeoutMs: number
  ): Promise<boolean> {
    const container = this.docker.getContainer(containerId);
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const info = await container.inspect();

      // Check if running
      if (!info.State.Running) {
        return false;
      }

      // If healthcheck defined, wait for healthy status
      if (info.State.Health) {
        if (info.State.Health.Status === "healthy") {
          return true;
        }
      } else {
        // No healthcheck defined, just check if running for 3 seconds
        if (Date.now() - startTime > 3000) {
          return true;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return false;
  }

  /**
   * Get container stats (CPU, memory, network)
   */
  async getBoxStats(containerId: string): Promise<BoxStats> {
    const container = this.docker.getContainer(containerId);
    const stats = await container.stats({ stream: false });

    // Calculate CPU percentage
    const cpuDelta =
      stats.cpu_stats.cpu_usage.total_usage -
      stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta =
      stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const cpuPercent =
      (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100;

    // Memory usage
    const memoryUsage = stats.memory_stats.usage;
    const memoryLimit = stats.memory_stats.limit;
    const memoryPercent = (memoryUsage / memoryLimit) * 100;

    return {
      cpuPercent: Math.round(cpuPercent * 100) / 100,
      memoryUsageMB: Math.round(memoryUsage / 1024 / 1024),
      memoryLimitMB: Math.round(memoryLimit / 1024 / 1024),
      memoryPercent: Math.round(memoryPercent * 100) / 100,
      networkRxBytes: stats.networks?.eth0?.rx_bytes || 0,
      networkTxBytes: stats.networks?.eth0?.tx_bytes || 0,
    };
  }

  /**
   * Ensure box directories exist with correct permissions
   */
  private async ensureBoxDirectories(
    userId: string,
    boxId: string
  ): Promise<void> {
    const basePath = `${this.baseDir}/${userId}`;
    const agentPath = `${basePath}/agents/${boxId}`;

    // Create directories
    await fs.mkdir(`${agentPath}/workspace`, { recursive: true });
    await fs.mkdir(`${agentPath}/.config`, { recursive: true });
    await fs.mkdir(`${agentPath}/.cache`, { recursive: true });
    await fs.mkdir(`${agentPath}/.inbox`, { recursive: true });
    await fs.mkdir(`${agentPath}/usr-local`, { recursive: true });
    await fs.mkdir(`${basePath}/shared`, { recursive: true });

    // Note: Ownership to 1000:1000 should be handled by deployment setup
    // or by running the API server with appropriate permissions
  }

  /**
   * Clean up box directories on deletion
   */
  private async cleanupBoxDirectories(
    userId: string,
    boxId: string
  ): Promise<void> {
    const agentPath = `${this.baseDir}/${userId}/agents/${boxId}`;

    try {
      await fs.rm(agentPath, { recursive: true, force: true });
    } catch (err) {
      console.error(`Failed to clean up ${agentPath}:`, err);
    }

    // NOTE: ${this.baseDir}/${userId}/shared is NOT deleted (shared by all agents)
  }
}
