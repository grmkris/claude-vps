import type { FlowJob } from "@vps-claude/queue";

import { DEPLOY_QUEUES } from "@vps-claude/queue";
import { WORKER_CONFIG } from "@vps-claude/shared";
import { SETUP_STEP_KEYS, type SetupStepKey } from "@vps-claude/sprites";

export interface SkillWithSource {
  skillId: string;
  topSource?: string;
}

export interface DeployFlowParams {
  boxId: string;
  deploymentAttempt: number;
  spriteName: string;
  spriteUrl: string;
  envVars: Record<string, string>;
  boxAgentBinaryUrl: string;
  skillsWithSources: SkillWithSource[];
  completedStepKeys?: string[];
  completedSkillIds?: string[];
  /** Unique suffix for job IDs to prevent deduplication on retry */
  jobIdSuffix?: string;
}

interface BaseJobData {
  boxId: string;
  deploymentAttempt: number;
  spriteName: string;
  spriteUrl: string;
}

/**
 * Build the deployment flow DAG for BullMQ FlowProducer
 *
 * CRITICAL: In BullMQ flows, children execute BEFORE parent.
 * So the structure is inverted from execution order:
 *
 * Flow Structure (parent → children):
 *   FINALIZE (root, runs LAST)
 *       └── HEALTH_CHECK
 *               └── ENABLE_ACCESS
 *                       ├── SETUP_STEP_10 (last setup step)
 *                       │       └── SETUP_STEP_9
 *                       │               └── ... → SETUP_STEP_1 (runs FIRST)
 *                       └── SKILLS_GATE (optional)
 *                               ├── SKILL_1
 *                               └── SKILL_2
 *
 * Execution Order (children first):
 *   1. SETUP_STEP_1 → SETUP_STEP_2 → ... → SETUP_STEP_10
 *   2. SKILL_1, SKILL_2 (parallel) → SKILLS_GATE
 *   3. ENABLE_ACCESS (must happen before health check - sets URL auth to public)
 *   4. HEALTH_CHECK (requires public URL access)
 *   5. FINALIZE (marks box as running)
 */
export function buildDeployFlow(params: DeployFlowParams): FlowJob {
  const {
    boxId,
    deploymentAttempt,
    spriteName,
    spriteUrl,
    envVars,
    boxAgentBinaryUrl,
    skillsWithSources,
    completedStepKeys = [],
    completedSkillIds = [],
    jobIdSuffix = "",
  } = params;

  // Helper to create unique job IDs (suffix prevents deduplication on retry)
  const makeJobId = (step: string) =>
    `${boxId}-${deploymentAttempt}-${step}${jobIdSuffix}`;

  const baseData: BaseJobData = {
    boxId,
    deploymentAttempt,
    spriteName,
    spriteUrl,
  };

  // Build setup step chain (sequential execution via nested children)
  // Skip already completed steps for resumable deployments
  const setupChain = buildSetupStepChain({
    baseData,
    envVars,
    boxAgentBinaryUrl,
    completedStepKeys,
    makeJobId,
  });

  // Enable access children: only include if there are steps to run
  const enableAccessChildren: FlowJob[] = [];

  if (setupChain) {
    enableAccessChildren.push(setupChain);
  }

  // Add skills gate if there are skills to install (excluding completed ones)
  const skillsToInstall = skillsWithSources.filter(
    (s) => !completedSkillIds.includes(s.skillId)
  );
  if (skillsToInstall.length > 0) {
    const skillsGate = buildSkillsGate({
      baseData,
      skillsWithSources: skillsToInstall,
      makeJobId,
    });
    if (skillsGate) {
      enableAccessChildren.push(skillsGate);
    }
  }

  // Build the full flow DAG
  // Order: setup steps → enable access → health check → finalize
  return {
    name: `finalize-${boxId}`,
    queueName: DEPLOY_QUEUES.finalize,
    data: baseData,
    opts: {
      jobId: makeJobId("finalize"),
    },
    children: [
      {
        name: `health-check-${boxId}`,
        queueName: DEPLOY_QUEUES.healthCheck,
        data: baseData,
        opts: {
          attempts: WORKER_CONFIG.healthCheck.attempts,
          backoff: WORKER_CONFIG.healthCheck.backoff,
          jobId: makeJobId("health-check"),
        },
        children: [
          {
            name: `enable-access-${boxId}`,
            queueName: DEPLOY_QUEUES.enableAccess,
            data: { boxId, deploymentAttempt, spriteName },
            opts: {
              attempts: WORKER_CONFIG.enableAccess.attempts,
              backoff: WORKER_CONFIG.enableAccess.backoff,
              jobId: makeJobId("enable-access"),
            },
            children: enableAccessChildren,
          },
        ],
      },
    ],
  };
}

interface SetupChainParams {
  baseData: BaseJobData;
  envVars: Record<string, string>;
  boxAgentBinaryUrl: string;
  completedStepKeys: string[];
  makeJobId: (step: string) => string;
}

/**
 * Steps that can run in parallel (no dependencies on each other)
 * These are downloads, directory creation, and cloning - all independent operations
 */
const PARALLEL_PHASE1_STEPS = [
  "SETUP_DOWNLOAD_AGENT",
  "SETUP_CREATE_DIRS",
  "SETUP_INSTALL_NGINX",
  "SETUP_CLONE_AGENT_APP",
] as const;

/**
 * Build setup step chain with Phase 1 parallelization
 *
 * Structure:
 * - Phase 1: 4 independent steps run in PARALLEL (download, dirs, nginx, clone)
 * - Phase 2+: Remaining steps run SEQUENTIALLY (depend on Phase 1 results)
 *
 * BullMQ flow execution order (children first):
 * 1. Phase 1 parallel jobs complete
 * 2. Phase 1 gate aggregates
 * 3. Sequential chain executes one by one
 *
 * This provides ~30-60s savings vs fully sequential execution.
 */
function buildSetupStepChain(params: SetupChainParams): FlowJob | undefined {
  const { baseData, envVars, boxAgentBinaryUrl, completedStepKeys, makeJobId } =
    params;
  const { boxId, deploymentAttempt, spriteName, spriteUrl } = baseData;

  // Filter out completed steps
  const stepsToRun = SETUP_STEP_KEYS.filter(
    (key) => !completedStepKeys.includes(key)
  );

  // All steps completed - nothing to do
  if (stepsToRun.length === 0) {
    return undefined;
  }

  // Helper to create a step job
  const createStepJob = (
    stepKey: SetupStepKey,
    children?: FlowJob[]
  ): FlowJob => {
    const stepOrder = SETUP_STEP_KEYS.indexOf(stepKey) + 1;
    return {
      name: `${stepKey}-${boxId}`,
      queueName: DEPLOY_QUEUES.setupStep,
      data: {
        boxId,
        deploymentAttempt,
        spriteName,
        spriteUrl,
        stepKey,
        stepOrder,
        envVars,
        boxAgentBinaryUrl,
      },
      opts: {
        attempts: WORKER_CONFIG.setupStep.attempts,
        backoff: WORKER_CONFIG.setupStep.backoff,
        jobId: makeJobId(stepKey),
      },
      ...(children && children.length > 0 ? { children } : {}),
    };
  };

  // Split steps into Phase 1 (parallel) and Phase 2+ (sequential)
  const phase1Steps = stepsToRun.filter((key) =>
    PARALLEL_PHASE1_STEPS.includes(
      key as (typeof PARALLEL_PHASE1_STEPS)[number]
    )
  );
  const sequentialSteps = stepsToRun.filter(
    (key) =>
      !PARALLEL_PHASE1_STEPS.includes(
        key as (typeof PARALLEL_PHASE1_STEPS)[number]
      )
  );

  // Build Phase 1 parallel jobs (if any)
  let phase1Gate: FlowJob | undefined;
  if (phase1Steps.length > 0) {
    const phase1Jobs = phase1Steps.map((stepKey) => createStepJob(stepKey));

    // Gate job that waits for all Phase 1 jobs
    phase1Gate = {
      name: `phase1-gate-${boxId}`,
      queueName: DEPLOY_QUEUES.setupStep,
      data: {
        boxId,
        deploymentAttempt,
        spriteName,
        spriteUrl,
        stepKey: "PHASE1_GATE",
        stepOrder: 0, // Meta step, not tracked in UI
        envVars,
        boxAgentBinaryUrl,
        isGate: true, // Worker will skip execution for gate jobs
      },
      opts: {
        jobId: makeJobId("phase1-gate"),
      },
      children: phase1Jobs,
    };
  }

  // Build sequential chain for Phase 2+ steps
  let sequentialChain: FlowJob | undefined;
  if (sequentialSteps.length > 0) {
    // Build chain from last to first (BullMQ children-first execution)
    for (const stepKey of sequentialSteps) {
      const job = createStepJob(
        stepKey,
        sequentialChain ? [sequentialChain] : undefined
      );
      sequentialChain = job;
    }
  }

  // Wire Phase 1 gate as child of first sequential step (if both exist)
  if (sequentialChain && phase1Gate) {
    // Find the deepest job in sequential chain and add phase1Gate as sibling child
    let deepest = sequentialChain;
    while (deepest.children && deepest.children.length > 0) {
      deepest = deepest.children[0]!;
    }
    deepest.children = [phase1Gate];
    return sequentialChain;
  }

  // Only Phase 1 or only sequential
  return sequentialChain ?? phase1Gate;
}

interface SkillsGateParams {
  baseData: BaseJobData;
  skillsWithSources: SkillWithSource[];
  makeJobId: (step: string) => string;
}

/**
 * Build skills gate with parallel skill installations as children
 *
 * Skills run in parallel (siblings), then skills-gate aggregates results.
 * Uses failParentOnFailure: false so partial failures don't block deployment.
 * Returns undefined if no skills to install.
 */
function buildSkillsGate(params: SkillsGateParams): FlowJob | undefined {
  const { baseData, skillsWithSources, makeJobId } = params;
  const { boxId, deploymentAttempt, spriteName, spriteUrl } = baseData;

  if (skillsWithSources.length === 0) {
    return undefined;
  }

  const skillJobs: FlowJob[] = skillsWithSources.map(
    ({ skillId, topSource }) => ({
      name: `skill-${skillId}-${boxId}`,
      queueName: DEPLOY_QUEUES.installSkill,
      data: {
        boxId,
        deploymentAttempt,
        spriteName,
        skillId,
        topSource, // Pre-resolved from skills.sh API
      },
      opts: {
        attempts: WORKER_CONFIG.installSkill.attempts,
        backoff: WORKER_CONFIG.installSkill.backoff,
        jobId: makeJobId(`skill-${skillId}`),
        failParentOnFailure: false, // Allow partial skill failures
      },
    })
  );

  return {
    name: `skills-gate-${boxId}`,
    queueName: DEPLOY_QUEUES.skillsGate,
    data: { boxId, deploymentAttempt, spriteName, spriteUrl },
    opts: {
      jobId: makeJobId("skills-gate"),
    },
    children: skillJobs,
  };
}
