import type { Logger } from "@vps-claude/logger";
import type { BoxId, UserId } from "@vps-claude/shared";
import type { SpritesClient } from "@vps-claude/sprites";

import type { BoxService } from "../services/box.service";

export interface ProxyHandlerDeps {
  boxService: BoxService;
  spritesClient: SpritesClient;
  logger: Logger;
}

export interface ProxyHandlerConfig {
  host: string;
  port: number;
}

/**
 * Creates WebSocket proxy handler configuration for a box
 * Returns the Sprites proxy URL and token for the frontend to connect directly
 *
 * Note: Due to WebSocket limitations in serverless environments,
 * we return proxy details for client-side connection rather than server-side proxying
 */
export function createProxyHandler(deps: ProxyHandlerDeps) {
  const { boxService, spritesClient, logger } = deps;

  return {
    /**
     * Get proxy connection details for a box
     * Client uses these to connect directly to Sprites proxy
     */
    async getProxyDetails(
      boxId: BoxId,
      userId: UserId,
      config: ProxyHandlerConfig
    ): Promise<{
      proxyUrl: string;
      token: string;
      host: string;
      port: number;
    } | null> {
      const boxResult = await boxService.getById(boxId);
      if (boxResult.isErr()) {
        logger.warn(
          { boxId, error: boxResult.error.message },
          "Failed to get box"
        );
        return null;
      }
      const box = boxResult.value;

      if (!box || box.userId !== userId) {
        logger.warn({ boxId, userId }, "Box not found or unauthorized");
        return null;
      }

      if (!box.spriteName || box.status !== "running") {
        logger.warn({ boxId, status: box.status }, "Box not running");
        return null;
      }

      const proxyUrl = spritesClient.getProxyUrl(box.spriteName);
      const token = spritesClient.getToken();

      logger.info(
        {
          boxId,
          spriteName: box.spriteName,
          host: config.host,
          port: config.port,
        },
        "Proxy details requested"
      );

      return {
        proxyUrl,
        token,
        host: config.host,
        port: config.port,
      };
    },
  };
}

export type ProxyHandler = ReturnType<typeof createProxyHandler>;
