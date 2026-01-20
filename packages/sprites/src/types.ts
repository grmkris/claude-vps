import { z } from "zod";

// Sprite status from API
export const SpriteStatus = z.enum([
  "running",
  "sleeping",
  "stopped",
  "creating",
  "error",
]);
export type SpriteStatus = z.infer<typeof SpriteStatus>;

// Sprite info from GET /sprites/{name}
export const SpriteInfo = z.object({
  name: z.string(),
  status: SpriteStatus,
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});
export type SpriteInfo = z.infer<typeof SpriteInfo>;

// Checkpoint info
export const Checkpoint = z.object({
  id: z.string(),
  sprite_name: z.string(),
  created_at: z.string(),
  size_bytes: z.number().optional(),
});
export type Checkpoint = z.infer<typeof Checkpoint>;

// Create sprite config
export interface CreateSpriteConfig {
  name: string;
  userId: string;
  subdomain: string;
  envVars: Record<string, string>;
}

// Exec result
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// Setup config for sprite provisioning
export interface SpriteSetupConfig {
  spriteName: string;
  password: string;
  boxAgentBinaryUrl: string;
  envVars: Record<string, string>;
}

// Proxy config for TCP tunneling
export interface ProxyConfig {
  host: string;
  port: number;
}

// Sprites client interface
export interface SpritesClient {
  createSprite: (
    config: CreateSpriteConfig
  ) => Promise<{ spriteName: string; url: string }>;
  deleteSprite: (spriteName: string) => Promise<void>;
  getSprite: (spriteName: string) => Promise<SpriteInfo | null>;
  execCommand: (spriteName: string, command: string) => Promise<ExecResult>;
  setupSprite: (config: SpriteSetupConfig) => Promise<void>;
  createCheckpoint: (spriteName: string) => Promise<Checkpoint>;
  listCheckpoints: (spriteName: string) => Promise<Checkpoint[]>;
  restoreCheckpoint: (
    spriteName: string,
    checkpointId: string
  ) => Promise<void>;
  getProxyUrl: (spriteName: string) => string;
  getToken: () => string;
}
