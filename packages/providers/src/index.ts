// Core types and interfaces
export type { ComputeProvider } from "./provider.interface";
export {
  ProviderType,
  InstanceStatus,
  ProviderConfig,
  type ProviderCapabilities,
  type InstanceInfo,
  type CreateInstanceConfig,
  type InstanceResult,
  type ExecResult,
  type Checkpoint,
  type FileInfo,
  type FsReadOptions,
  type FsWriteOptions,
  type FsListOptions,
  type SetupStepConfig,
  type ProviderHostConfig,
} from "./types";

// Factory
export {
  createProviderFactory,
  type ProviderFactory,
  type ProviderFactoryOptions,
} from "./provider-factory";

// Sprites provider
export { createSpritesProvider, type SpritesProviderOptions } from "./sprites";

// Docker provider
export {
  createDockerProvider,
  createDockerClient,
  generateTraefikLabels,
  getContainerUrl,
  type DockerProviderOptions,
  type DockerClient,
  type DockerClientOptions,
  type TraefikLabelConfig,
} from "./docker";
