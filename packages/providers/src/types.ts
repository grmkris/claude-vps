import { z } from "zod";

// Provider types
export const ProviderType = z.enum(["sprites", "docker"]);
export type ProviderType = z.infer<typeof ProviderType>;

// Provider capabilities - what each provider supports
export interface ProviderCapabilities {
  /** Supports checkpointing/snapshotting */
  checkpoints: boolean;
  /** Supports sleep/wake lifecycle */
  sleepWake: boolean;
  /** Supports WebSocket proxy for terminal access */
  wsProxy: boolean;
  /** Supports URL auth settings (public/private) */
  urlAuth: boolean;
  /** Supports environment variable hot-reload */
  envHotReload: boolean;
}

// Instance status
export const InstanceStatus = z.enum([
  "creating",
  "running",
  "sleeping",
  "stopped",
  "error",
]);
export type InstanceStatus = z.infer<typeof InstanceStatus>;

// Instance info returned by provider
export interface InstanceInfo {
  name: string;
  status: InstanceStatus;
  createdAt?: string;
  updatedAt?: string;
}

// Config for creating a new instance
export interface CreateInstanceConfig {
  /** Unique instance name */
  name: string;
  /** User ID (for namespacing) */
  userId: string;
  /** Subdomain for public URL */
  subdomain: string;
  /** Environment variables to inject */
  envVars: Record<string, string>;
}

// Result of instance creation
export interface InstanceResult {
  /** Provider-assigned instance name */
  instanceName: string;
  /** Public URL for the instance */
  url: string;
}

// Command execution result
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// Checkpoint info
export interface Checkpoint {
  id: string;
  instanceName: string;
  createdAt: string;
  sizeBytes?: number;
}

// Filesystem types
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

// Setup step configuration
export interface SetupStepConfig {
  instanceName: string;
  stepKey: string;
  boxAgentBinaryUrl: string;
  envVars: Record<string, string>;
  instanceUrl: string;
  mcpServers?: Record<string, unknown>;
}

// Provider host configuration (for Docker hosts)
export interface ProviderHostConfig {
  id: string;
  type: ProviderType;
  /** Docker socket path or TCP URL */
  dockerHost?: string;
  /** Base domain for routing (e.g., agents.example.com) */
  baseDomain?: string;
  /** Whether this host is available for new instances */
  enabled: boolean;
}

// Provider configuration schema
export const ProviderConfig = z.object({
  type: ProviderType,
  hostId: z.string().optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfig>;
