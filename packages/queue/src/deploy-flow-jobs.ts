import { BoxId, UserId } from "@vps-claude/shared";
import { z } from "zod";

/**
 * Queue names for the deploy flow DAG
 */
export const bDEPLOY_QUEUES = {
  orchestrator: "deploy-orchestrator",
  createSprite: "deploy-create-sprite",
  setupStep: "deploy-setup-step",
  healthCheck: "deploy-health-check",
  installSkill: "deploy-install-skill",
  enableAccess: "deploy-enable-access",
  finalize: "deploy-finalize",
  skillsGate: "deploy-skills-gate",
} as const;

/**
 * Orchestrator job - parent job that coordinates the entire deploy flow
 */
export const DeployOrchestratorJobData = z.object({
  boxId: BoxId,
  userId: UserId,
  subdomain: z.string(),
  skills: z.array(z.string()).default([]),
  deploymentAttempt: z.number().int().min(1).default(1),
});
export type DeployOrchestratorJobData = z.infer<
  typeof DeployOrchestratorJobData
>;

/**
 * Create sprite job - creates the VM on Fly.io
 */
export const CreateSpriteJobData = z.object({
  boxId: BoxId,
  userId: UserId,
  subdomain: z.string(),
  deploymentAttempt: z.number().int().min(1),
});
export type CreateSpriteJobData = z.infer<typeof CreateSpriteJobData>;

/**
 * Setup step job - runs a single setup substep
 */
export const SetupStepJobData = z.object({
  boxId: BoxId,
  deploymentAttempt: z.number().int().min(1),
  spriteName: z.string(),
  spriteUrl: z.string(),
  stepKey: z.string(),
  stepOrder: z.number().int().min(1),
  envVars: z.record(z.string(), z.string()),
  boxAgentBinaryUrl: z.string(),
});
export type SetupStepJobData = z.infer<typeof SetupStepJobData>;

/**
 * Health check job - verifies services are running
 */
export const HealthCheckJobData = z.object({
  boxId: BoxId,
  deploymentAttempt: z.number().int().min(1),
  spriteName: z.string(),
  spriteUrl: z.string(),
});
export type HealthCheckJobData = z.infer<typeof HealthCheckJobData>;

/**
 * Install skill job - installs a single skill via CLI
 */
export const InstallSkillJobData = z.object({
  boxId: BoxId,
  deploymentAttempt: z.number().int().min(1),
  spriteName: z.string(),
  skillId: z.string(),
  topSource: z.string().optional(),
});
export type InstallSkillJobData = z.infer<typeof InstallSkillJobData>;

/**
 * Enable access job - sets URL auth to public
 */
export const EnableAccessJobData = z.object({
  boxId: BoxId,
  deploymentAttempt: z.number().int().min(1),
  spriteName: z.string(),
});
export type EnableAccessJobData = z.infer<typeof EnableAccessJobData>;

/**
 * Finalize job - marks box as running (root of flow DAG)
 */
export const FinalizeJobData = z.object({
  boxId: BoxId,
  deploymentAttempt: z.number().int().min(1),
  spriteName: z.string(),
  spriteUrl: z.string(),
});
export type FinalizeJobData = z.infer<typeof FinalizeJobData>;

/**
 * Skills gate job - waits for all skill installations to complete
 */
export const SkillsGateJobData = z.object({
  boxId: BoxId,
  deploymentAttempt: z.number().int().min(1),
  spriteName: z.string(),
  spriteUrl: z.string(),
});
export type SkillsGateJobData = z.infer<typeof SkillsGateJobData>;

/**
 * Shared result type for deploy jobs
 */
export interface DeployJobResult {
  success: boolean;
  error?: string;
  /** Sprite info returned from CREATE_SPRITE */
  spriteName?: string;
  spriteUrl?: string;
}
