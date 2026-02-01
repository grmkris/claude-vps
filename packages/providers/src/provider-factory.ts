import type { Logger } from "@vps-claude/logger";
import type { SpritesClient } from "@vps-claude/sprites";

import type { ComputeProvider } from "./provider.interface";
import type { ProviderType } from "./types";

import { createDockerProvider, type DockerProviderOptions } from "./docker";
import { createSpritesProvider } from "./sprites";

export interface ProviderFactoryOptions {
  /** Sprites client (required if using sprites provider) */
  spritesClient?: SpritesClient;
  /** Docker provider options (required if using docker provider) */
  dockerOptions?: Omit<DockerProviderOptions, "logger">;
  /** Logger instance */
  logger: Logger;
}

/**
 * ProviderFactory - creates and caches provider instances
 *
 * Usage:
 * ```ts
 * const factory = createProviderFactory({ spritesClient, logger });
 * const provider = factory.getProvider("sprites");
 * await provider.createInstance({ ... });
 * ```
 */
export function createProviderFactory(options: ProviderFactoryOptions) {
  const { spritesClient, dockerOptions, logger } = options;

  // Cache provider instances
  const providers = new Map<string, ComputeProvider>();

  /**
   * Get or create a provider instance
   *
   * @param type - Provider type ("sprites" or "docker")
   * @param hostId - Optional host ID for multi-host deployments
   */
  function getProvider(type: ProviderType, hostId?: string): ComputeProvider {
    const cacheKey = hostId ? `${type}:${hostId}` : type;

    const cached = providers.get(cacheKey);
    if (cached) {
      return cached;
    }

    const provider = createProvider(type, hostId);
    providers.set(cacheKey, provider);
    return provider;
  }

  /**
   * Create a new provider instance
   */
  function createProvider(
    type: ProviderType,
    _hostId?: string
  ): ComputeProvider {
    switch (type) {
      case "sprites": {
        if (!spritesClient) {
          throw new Error(
            "SpritesClient not configured - cannot create sprites provider"
          );
        }
        return createSpritesProvider({ spritesClient, logger });
      }

      case "docker": {
        if (!dockerOptions) {
          throw new Error(
            "Docker options not configured - cannot create docker provider"
          );
        }
        return createDockerProvider({ ...dockerOptions, logger });
      }

      default:
        throw new Error(`Unknown provider type: ${type}`);
    }
  }

  /**
   * Get provider for a box based on stored configuration
   */
  function getProviderForBox(box: {
    provider?: ProviderType | null;
    providerHostId?: string | null;
  }): ComputeProvider {
    const type = box.provider ?? "sprites";
    return getProvider(type, box.providerHostId ?? undefined);
  }

  /**
   * Get default provider (sprites for backwards compatibility)
   */
  function getDefaultProvider(): ComputeProvider {
    return getProvider("sprites");
  }

  /**
   * Check if a provider type is available/configured
   */
  function isProviderAvailable(type: ProviderType): boolean {
    switch (type) {
      case "sprites":
        return !!spritesClient;
      case "docker":
        return !!dockerOptions;
      default:
        return false;
    }
  }

  /**
   * List available providers
   */
  function listAvailableProviders(): ProviderType[] {
    const available: ProviderType[] = [];
    if (spritesClient) available.push("sprites");
    if (dockerOptions) available.push("docker");
    return available;
  }

  return {
    getProvider,
    getProviderForBox,
    getDefaultProvider,
    isProviderAvailable,
    listAvailableProviders,
  };
}

export type ProviderFactory = ReturnType<typeof createProviderFactory>;
