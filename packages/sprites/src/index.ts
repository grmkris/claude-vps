export {
  createSpritesClient,
  type SpritesClientOptions,
} from "./sprites-client";
export type {
  Checkpoint,
  CreateSpriteConfig,
  ExecResult,
  FileInfo,
  FsListOptions,
  FsReadOptions,
  FsWriteOptions,
  SetupProgressCallback,
  SetupStepConfig,
  SetupStepKey,
  SpriteInfo,
  SpriteSetupConfig,
  SpriteStatus,
  SpritesClient,
} from "./types";
export { SETUP_STEP_KEYS } from "./types";

// Re-export official SDK for advanced usage
export {
  SpritesClient as FlySpritesClient,
  Sprite as FlySprite,
} from "@fly/sprites";
export type {
  SpriteConfig,
  SpawnOptions,
  ExecOptions,
  Session,
} from "@fly/sprites";
