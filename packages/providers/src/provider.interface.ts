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
} from "./types";

/**
 * ComputeProvider interface - abstracts compute providers (Sprites, Docker, etc.)
 *
 * All providers must implement core lifecycle, exec, and filesystem operations.
 * Optional methods are available for provider-specific features.
 */
export interface ComputeProvider {
  /** Provider type identifier */
  readonly type: ProviderType;

  /** Provider capabilities */
  readonly capabilities: ProviderCapabilities;

  // =========================================================================
  // Lifecycle Operations
  // =========================================================================

  /**
   * Create a new compute instance
   */
  createInstance(config: CreateInstanceConfig): Promise<InstanceResult>;

  /**
   * Delete an instance
   */
  deleteInstance(instanceName: string): Promise<void>;

  /**
   * Get instance info
   * @returns Instance info or null if not found
   */
  getInstance(instanceName: string): Promise<InstanceInfo | null>;

  /**
   * List all instances managed by this provider
   */
  listInstances(): Promise<InstanceInfo[]>;

  // =========================================================================
  // Command Execution
  // =========================================================================

  /**
   * Execute a command directly (no shell interpretation)
   */
  execCommand(instanceName: string, command: string): Promise<ExecResult>;

  /**
   * Execute a shell command (with bash interpretation)
   * Supports heredocs, pipes, redirects, variable expansion
   */
  execShell(instanceName: string, command: string): Promise<ExecResult>;

  // =========================================================================
  // Filesystem Operations
  // =========================================================================

  /**
   * Read file contents from instance
   */
  readFile(
    instanceName: string,
    path: string,
    opts?: FsReadOptions
  ): Promise<Buffer>;

  /**
   * Write file to instance
   */
  writeFile(
    instanceName: string,
    path: string,
    content: Buffer | string,
    opts?: FsWriteOptions
  ): Promise<void>;

  /**
   * List directory contents on instance
   */
  listDir(
    instanceName: string,
    path: string,
    opts?: FsListOptions
  ): Promise<FileInfo[]>;

  // =========================================================================
  // Setup & Health
  // =========================================================================

  /**
   * Run a setup step on the instance
   * Setup steps configure the instance (install packages, create services, etc.)
   */
  runSetupStep(config: SetupStepConfig): Promise<ExecResult>;

  /**
   * Check if instance services are healthy
   */
  checkHealth(instanceName: string, instanceUrl: string): Promise<boolean>;

  /**
   * Update environment variables on a running instance
   */
  updateEnvVars(
    instanceName: string,
    envVars: Record<string, string>
  ): Promise<void>;

  // =========================================================================
  // Networking
  // =========================================================================

  /**
   * Get the public URL for an instance
   * @returns URL or null if not publicly accessible
   */
  getPublicUrl(instanceName: string): string | null;

  // =========================================================================
  // Optional: Checkpoints (Sprites-specific)
  // =========================================================================

  /**
   * Create a checkpoint/snapshot of the instance
   * Only available if capabilities.checkpoints is true
   */
  createCheckpoint?(instanceName: string): Promise<Checkpoint>;

  /**
   * List available checkpoints for an instance
   */
  listCheckpoints?(instanceName: string): Promise<Checkpoint[]>;

  /**
   * Restore instance to a checkpoint
   */
  restoreCheckpoint?(instanceName: string, checkpointId: string): Promise<void>;

  // =========================================================================
  // Optional: URL Auth (Sprites-specific)
  // =========================================================================

  /**
   * Set URL authentication mode
   * Only available if capabilities.urlAuth is true
   */
  setUrlAuth?(instanceName: string, auth: "public" | "private"): Promise<void>;

  // =========================================================================
  // Optional: WebSocket Proxy (Sprites-specific)
  // =========================================================================

  /**
   * Get WebSocket proxy URL for terminal access
   * Only available if capabilities.wsProxy is true
   */
  getProxyUrl?(instanceName: string): string;

  /**
   * Get proxy authentication token
   */
  getProxyToken?(): string;
}
