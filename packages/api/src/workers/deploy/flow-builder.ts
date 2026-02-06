import type { FlowJob } from "@vps-claude/queue";

import { DEPLOY_QUEUES } from "@vps-claude/queue";
import { WORKER_CONFIG } from "@vps-claude/shared";
import { SETUP_STEP_KEYS, type SetupStepKey } from "@vps-claude/sprites";

export interface SkillWithSource {
  skillId: string;
  source?: string;
}

export interface DeployFlowParams {
  boxId: string;
  deploymentAttempt: number;
  instanceName: string;
  instanceUrl: string;
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
  instanceName: string;
  instanceUrl: string;
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
 *                       ├── SETUP_STEP_10 (last sequential step)
 *                       │       └── SETUP_STEP_9
 *                       │               └── SETUP_STEP_5 (first sequential)
 *                       │                       ├── SETUP_STEP_1 (parallel)
 *                       │                       ├── SETUP_STEP_2 (parallel)
 *                       │                       ├── SETUP_STEP_3 (parallel)
 *                       │                       └── SETUP_STEP_4 (parallel)
 *                       └── SKILLS_GATE (optional)
 *                               ├── SKILL_1
 *                               └── SKILL_2
 *
 * Execution Order (children first):
 *   1. Phase 1: SETUP_1-4 run in PARALLEL (all as children of first sequential step)
 *   2. Phase 2+: Sequential steps run one by one
 *   3. SKILL_1, SKILL_2 (parallel) → SKILLS_GATE
 *   4. ENABLE_ACCESS (sets URL auth to public)
 *   5. HEALTH_CHECK (requires public URL access)
 *   6. FINALIZE (marks box as running)
 */
export function buildDeployFlow(params: DeployFlowParams): FlowJob {
  const {
    boxId,
    deploymentAttempt,
    instanceName,
    instanceUrl,
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
    instanceName,
    instanceUrl,
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
            data: { boxId, deploymentAttempt, instanceName },
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
 * 1. Phase 1 parallel jobs complete (as children of first sequential step)
 * 2. Sequential chain executes one by one
 *
 * No explicit gate job needed - BullMQ guarantees parent won't run until
 * all children complete. This provides ~30-60s savings vs fully sequential.
 */
function buildSetupStepChain(params: SetupChainParams): FlowJob | undefined {
  const { baseData, envVars, boxAgentBinaryUrl, completedStepKeys, makeJobId } =
    params;
  const { boxId, deploymentAttempt, instanceName, instanceUrl } = baseData;

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
        instanceName,
        instanceUrl,
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
  const phase1Jobs =
    phase1Steps.length > 0
      ? phase1Steps.map((stepKey) => createStepJob(stepKey))
      : [];

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

  // Attach Phase 1 parallel jobs directly to first sequential step
  // BullMQ guarantees parent won't run until all children complete - no gate needed
  if (sequentialChain && phase1Jobs.length > 0) {
    // Find the deepest job in sequential chain (first to execute)
    let deepest = sequentialChain;
    while (deepest.children && deepest.children.length > 0) {
      deepest = deepest.children[0]!;
    }
    deepest.children = phase1Jobs;
    return sequentialChain;
  }

  // Edge case: Only Phase 1 parallel jobs remain (rare - only on resume)
  // Since we can only return one FlowJob, chain them sequentially
  if (phase1Jobs.length > 0 && !sequentialChain) {
    const [first, ...rest] = phase1Jobs;
    if (rest.length > 0) {
      // Chain phase1 jobs sequentially (slight perf loss, but correct)
      let chain: FlowJob = first!;
      for (const job of rest) {
        job.children = [chain];
        chain = job;
      }
      return chain;
    }
    return first;
  }

  // Only sequential steps (no phase1)
  return sequentialChain;
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
  const { boxId, deploymentAttempt, instanceName, instanceUrl } = baseData;

  if (skillsWithSources.length === 0) {
    return undefined;
  }

  const skillJobs: FlowJob[] = skillsWithSources.map(({ skillId, source }) => ({
    name: `skill-${skillId}-${boxId}`,
    queueName: DEPLOY_QUEUES.installSkill,
    data: {
      boxId,
      deploymentAttempt,
      instanceName,
      skillId,
      source, // Pre-resolved from skills.sh API
    },
    opts: {
      attempts: WORKER_CONFIG.installSkill.attempts,
      backoff: WORKER_CONFIG.installSkill.backoff,
      jobId: makeJobId(`skill-${skillId}`),
      failParentOnFailure: false, // Allow partial skill failures
    },
  }));

  return {
    name: `skills-gate-${boxId}`,
    queueName: DEPLOY_QUEUES.skillsGate,
    data: { boxId, deploymentAttempt, instanceName, instanceUrl },
    opts: {
      jobId: makeJobId("skills-gate"),
    },
    children: skillJobs,
  };
}
