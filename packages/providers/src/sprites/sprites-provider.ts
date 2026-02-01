import type { Logger } from "@vps-claude/logger";
import type { SpritesClient } from "@vps-claude/sprites";

import type { ComputeProvider } from "../provider.interface";
import type {
  Checkpoint,
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

export interface SpritesProviderOptions {
  spritesClient: SpritesClient;
  logger: Logger;
}

/**
 * SpritesProvider - wraps the existing SpritesClient to implement ComputeProvider
 *
 * This is a thin adapter that delegates to SpritesClient.
 * Sprites (Fly.io) provides all capabilities: checkpoints, sleep/wake, wsProxy, urlAuth.
 */
export function createSpritesProvider(
  options: SpritesProviderOptions
): ComputeProvider {
  const { spritesClient, logger } = options;

  const provider: ComputeProvider = {
    type: "sprites" as ProviderType,

    capabilities: {
      checkpoints: true,
      sleepWake: true,
      wsProxy: true,
      urlAuth: true,
      envHotReload: true,
    } satisfies ProviderCapabilities,

    // =========================================================================
    // Lifecycle
    // =========================================================================

    async createInstance(
      config: CreateInstanceConfig
    ): Promise<InstanceResult> {
      // Don't log envVars - may contain secrets
      logger.info(
        { userId: config.userId, subdomain: config.subdomain },
        "SpritesProvider: Creating instance"
      );

      const result = await spritesClient.createSprite({
        name: config.name,
        userId: config.userId,
        subdomain: config.subdomain,
        envVars: config.envVars,
      });

      return {
        instanceName: result.spriteName,
        url: result.url,
      };
    },

    async deleteInstance(instanceName: string): Promise<void> {
      logger.info({ instanceName }, "SpritesProvider: Deleting instance");
      await spritesClient.deleteSprite(instanceName);
    },

    async getInstance(instanceName: string): Promise<InstanceInfo | null> {
      const sprite = await spritesClient.getSprite(instanceName);
      if (!sprite) return null;

      return {
        name: sprite.name,
        status: sprite.status,
        createdAt: sprite.created_at,
        updatedAt: sprite.updated_at,
      };
    },

    async listInstances(): Promise<InstanceInfo[]> {
      const sprites = await spritesClient.listSprites();
      // listSprites only returns names, need to fetch full info
      // For now, return minimal info
      return sprites.map((s) => ({
        name: s.name,
        status: "running" as const, // Default, would need individual getSprite calls for actual status
      }));
    },

    // =========================================================================
    // Command Execution
    // =========================================================================

    async execCommand(
      instanceName: string,
      command: string
    ): Promise<ExecResult> {
      return spritesClient.execCommand(instanceName, command);
    },

    async execShell(
      instanceName: string,
      command: string
    ): Promise<ExecResult> {
      return spritesClient.execShell(instanceName, command);
    },

    // =========================================================================
    // Filesystem
    // =========================================================================

    async readFile(
      instanceName: string,
      path: string,
      opts?: FsReadOptions
    ): Promise<Buffer> {
      return spritesClient.readFile(instanceName, path, opts);
    },

    async writeFile(
      instanceName: string,
      path: string,
      content: Buffer | string,
      opts?: FsWriteOptions
    ): Promise<void> {
      return spritesClient.writeFile(instanceName, path, content, opts);
    },

    async listDir(
      instanceName: string,
      path: string,
      opts?: FsListOptions
    ): Promise<FileInfo[]> {
      return spritesClient.listDir(instanceName, path, opts);
    },

    // =========================================================================
    // Setup & Health
    // =========================================================================

    async runSetupStep(config: SetupStepConfig): Promise<ExecResult> {
      return spritesClient.runSetupStep({
        spriteName: config.instanceName,
        stepKey: config.stepKey,
        boxAgentBinaryUrl: config.boxAgentBinaryUrl,
        envVars: config.envVars,
        spriteUrl: config.instanceUrl,
      });
    },

    async checkHealth(
      instanceName: string,
      instanceUrl: string
    ): Promise<boolean> {
      return spritesClient.checkHealth(instanceName, instanceUrl);
    },

    async updateEnvVars(
      instanceName: string,
      envVars: Record<string, string>
    ): Promise<void> {
      return spritesClient.updateEnvVars(instanceName, envVars);
    },

    // =========================================================================
    // Networking
    // =========================================================================

    getPublicUrl(_instanceName: string): string | null {
      // Sprites URLs are known at creation time and stored in DB
      // The provider doesn't track this - caller should use stored URL
      return null;
    },

    // =========================================================================
    // Optional: Checkpoints
    // =========================================================================

    async createCheckpoint(instanceName: string): Promise<Checkpoint> {
      const checkpoint = await spritesClient.createCheckpoint(instanceName);
      return {
        id: checkpoint.id,
        instanceName: checkpoint.sprite_name,
        createdAt: checkpoint.created_at,
        sizeBytes: checkpoint.size_bytes,
      };
    },

    async listCheckpoints(instanceName: string): Promise<Checkpoint[]> {
      const checkpoints = await spritesClient.listCheckpoints(instanceName);
      return checkpoints.map((cp) => ({
        id: cp.id,
        instanceName: cp.sprite_name,
        createdAt: cp.created_at,
        sizeBytes: cp.size_bytes,
      }));
    },

    async restoreCheckpoint(
      instanceName: string,
      checkpointId: string
    ): Promise<void> {
      return spritesClient.restoreCheckpoint(instanceName, checkpointId);
    },

    // =========================================================================
    // Optional: URL Auth
    // =========================================================================

    async setUrlAuth(
      instanceName: string,
      auth: "public" | "private"
    ): Promise<void> {
      // Map our "private" to Sprites' "sprite" auth mode
      const spriteAuth = auth === "private" ? "sprite" : "public";
      return spritesClient.setUrlAuth(instanceName, spriteAuth);
    },

    // =========================================================================
    // Optional: WebSocket Proxy
    // =========================================================================

    getProxyUrl(instanceName: string): string {
      return spritesClient.getProxyUrl(instanceName);
    },

    getProxyToken(): string {
      return spritesClient.getToken();
    },
  };

  return provider;
}
