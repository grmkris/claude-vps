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

/** Progress callback for tracking setup steps */
export type SetupProgressCallback = (
  stepKey: string,
  status: "start" | "complete" | "error",
  error?: string
) => Promise<void>;

// Setup config for sprite provisioning
export interface SpriteSetupConfig {
  spriteName: string;
  boxAgentBinaryUrl: string;
  envVars: Record<string, string>;
  /** Sprite public URL (e.g., https://subdomain.sprites.dev) */
  spriteUrl: string;
  /** Callback for progress tracking */
  onProgress?: SetupProgressCallback;
  /** Resume from specific step order (skip completed steps) */
  resumeFromStep?: number;
}

// Config for running a single setup step
export interface SetupStepConfig {
  spriteName: string;
  stepKey: string;
  boxAgentBinaryUrl: string;
  envVars: Record<string, string>;
  spriteUrl: string;
}

// Proxy config for TCP tunneling
export interface ProxyConfig {
  host: string;
  port: number;
}

// Filesystem API types
export interface FileInfo {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  modTime?: string;
  mode?: string;
}

export interface FsReadOptions {
  workingDir?: string;
}

export interface FsWriteOptions {
  workingDir?: string;
  mode?: string; // octal e.g. '0644'
  mkdir?: boolean; // auto-create parent dirs
}

export interface FsListOptions {
  workingDir?: string;
}

// Setup step keys - exported for workers to use
export const SETUP_STEP_KEYS = [
  "SETUP_DOWNLOAD_AGENT",
  "SETUP_CREATE_DIRS",
  "SETUP_ENV_VARS",
  "SETUP_CREATE_ENV_FILE",
  "SETUP_BOX_AGENT_SERVICE",
  "SETUP_INSTALL_NGINX",
  "SETUP_NGINX_SERVICE",
  "SETUP_CLONE_AGENT_APP",
  "SETUP_INSTALL_AGENT_APP",
  "SETUP_AGENT_APP_SERVICE",
] as const;

export type SetupStepKey = (typeof SETUP_STEP_KEYS)[number];

// Sprites client interface
export interface SpritesClient {
  createSprite: (
    config: CreateSpriteConfig
  ) => Promise<{ spriteName: string; url: string }>;
  listSprites: () => Promise<Array<{ name: string }>>;
  deleteSprite: (spriteName: string) => Promise<void>;
  getSprite: (spriteName: string) => Promise<SpriteInfo | null>;
  execCommand: (spriteName: string, command: string) => Promise<ExecResult>;
  /** Execute shell command with bash -c wrapper (supports heredocs, pipes, redirects) */
  execShell: (spriteName: string, command: string) => Promise<ExecResult>;
  /** Run all setup steps (legacy monolithic approach) */
  setupSprite: (config: SpriteSetupConfig) => Promise<void>;
  /** Run a single setup step by key (for modular workers) */
  runSetupStep: (config: SetupStepConfig) => Promise<ExecResult>;
  /** Check if services are healthy */
  checkHealth: (spriteName: string, spriteUrl: string) => Promise<boolean>;
  createCheckpoint: (spriteName: string) => Promise<Checkpoint>;
  listCheckpoints: (spriteName: string) => Promise<Checkpoint[]>;
  restoreCheckpoint: (
    spriteName: string,
    checkpointId: string
  ) => Promise<void>;
  getProxyUrl: (spriteName: string) => string;
  getToken: () => string;
  updateEnvVars: (
    spriteName: string,
    envVars: Record<string, string>
  ) => Promise<void>;

  // Filesystem API
  readFile: (
    spriteName: string,
    path: string,
    opts?: FsReadOptions
  ) => Promise<Buffer>;
  writeFile: (
    spriteName: string,
    path: string,
    content: Buffer | string,
    opts?: FsWriteOptions
  ) => Promise<void>;
  listDir: (
    spriteName: string,
    path: string,
    opts?: FsListOptions
  ) => Promise<FileInfo[]>;

  /** Set URL auth mode (public or sprite-token required) */
  setUrlAuth: (spriteName: string, auth: "public" | "sprite") => Promise<void>;
}
