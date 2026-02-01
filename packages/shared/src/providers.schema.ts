import { z } from "zod";

/**
 * Provider types supported by the system
 */
export const ProviderType = z.enum(["sprites", "docker"]);
export type ProviderType = z.infer<typeof ProviderType>;

/**
 * Docker host configuration
 */
export const DockerHostConfig = z.object({
  id: z.string(),
  /** Docker socket path or TCP URL */
  socketPath: z.string().optional(),
  host: z.string().optional(),
  port: z.number().optional(),
  /** Base domain for Traefik routing */
  baseDomain: z.string(),
  /** Whether this host accepts new boxes */
  enabled: z.boolean().default(true),
});
export type DockerHostConfig = z.infer<typeof DockerHostConfig>;

/**
 * Provider configuration for the application
 */
export const ProviderConfig = z.object({
  /** Default provider for new boxes */
  defaultProvider: ProviderType.default("sprites"),
  /** Sprites API token (required if using sprites) */
  spritesToken: z.string().optional(),
  /** Docker hosts configuration (required if using docker) */
  dockerHosts: z.array(DockerHostConfig).default([]),
});
export type ProviderConfig = z.infer<typeof ProviderConfig>;

/**
 * Get default provider configuration from environment
 */
export function getProviderConfigFromEnv(): ProviderConfig {
  return ProviderConfig.parse({
    defaultProvider: process.env.DEFAULT_PROVIDER ?? "sprites",
    spritesToken: process.env.SPRITES_TOKEN,
    dockerHosts: process.env.DOCKER_HOSTS
      ? JSON.parse(process.env.DOCKER_HOSTS)
      : [],
  });
}
