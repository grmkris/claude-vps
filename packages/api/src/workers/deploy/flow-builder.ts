import type { FlowJob } from "@vps-claude/queue";

import { DEPLOY_QUEUES } from "@vps-claude/queue";
import { WORKER_CONFIG } from "@vps-claude/shared";
import { SETUP_STEP_KEYS } from "@vps-claude/sprites";

export interface DeployFlowParams {
  boxId: string;
  deploymentAttempt: number;
  spriteName: string;
  spriteUrl: string;
  envVars: Record<string, string>;
  boxAgentBinaryUrl: string;
  skills: string[];
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
    skills,
  } = params;

  const baseData: BaseJobData = {
    boxId,
    deploymentAttempt,
    spriteName,
    spriteUrl,
  };

  // Build setup step chain (sequential execution via nested children)
  const setupChain = buildSetupStepChain({
    baseData,
    envVars,
    boxAgentBinaryUrl,
  });

  // Enable access children: setup chain is always required
  // Enable access must run BEFORE health check (sets URL auth to public)
  const enableAccessChildren: FlowJob[] = [setupChain];

  // Add skills gate if there are skills to install
  if (skills.length > 0) {
    const skillsGate = buildSkillsGate({ baseData, skills });
    enableAccessChildren.push(skillsGate);
  }

  // Build the full flow DAG
  // Order: setup steps → enable access → health check → finalize
  return {
    name: `finalize-${boxId}`,
    queueName: DEPLOY_QUEUES.finalize,
    data: baseData,
    opts: {
      jobId: `${boxId}-${deploymentAttempt}-finalize`,
    },
    children: [
      {
        name: `health-check-${boxId}`,
        queueName: DEPLOY_QUEUES.healthCheck,
        data: baseData,
        opts: {
          attempts: WORKER_CONFIG.healthCheck.attempts,
          backoff: WORKER_CONFIG.healthCheck.backoff,
          jobId: `${boxId}-${deploymentAttempt}-health-check`,
        },
        children: [
          {
            name: `enable-access-${boxId}`,
            queueName: DEPLOY_QUEUES.enableAccess,
            data: { boxId, deploymentAttempt, spriteName },
            opts: {
              attempts: WORKER_CONFIG.enableAccess.attempts,
              backoff: WORKER_CONFIG.enableAccess.backoff,
              jobId: `${boxId}-${deploymentAttempt}-enable-access`,
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
}

/**
 * Build sequential setup step chain
 *
 * Creates nested children where:
 * - SETUP_STEP_1 is the deepest leaf (executes FIRST)
 * - SETUP_STEP_10 is the root (executes LAST)
 *
 * This ensures sequential execution in BullMQ flow order.
 */
function buildSetupStepChain(params: SetupChainParams): FlowJob {
  const { baseData, envVars, boxAgentBinaryUrl } = params;
  const { boxId, deploymentAttempt, spriteName, spriteUrl } = baseData;

  let chain: FlowJob | undefined;

  // Iterate through steps in order
  // Each step becomes a child of the previous (deeper = runs first)
  for (let i = 0; i < SETUP_STEP_KEYS.length; i++) {
    const stepKey = SETUP_STEP_KEYS[i];
    const stepOrder = i + 1;

    const job: FlowJob = {
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
        jobId: `${boxId}-${deploymentAttempt}-${stepKey}`,
      },
    };

    // Previous chain becomes child of current job
    // This creates: STEP_10 → STEP_9 → ... → STEP_1
    // But executes: STEP_1 first (deepest child)
    if (chain) {
      job.children = [chain];
    }

    chain = job;
  }

  // Return STEP_10 as root (runs last), STEP_1 is deepest leaf (runs first)
  return chain!;
}

interface SkillsGateParams {
  baseData: BaseJobData;
  skills: string[];
}

/**
 * Build skills gate with parallel skill installations as children
 *
 * Skills run in parallel (siblings), then skills-gate aggregates results.
 * Uses failParentOnFailure: false so partial failures don't block deployment.
 */
function buildSkillsGate(params: SkillsGateParams): FlowJob {
  const { baseData, skills } = params;
  const { boxId, deploymentAttempt, spriteName, spriteUrl } = baseData;

  const skillJobs: FlowJob[] = skills.map((skillId) => ({
    name: `skill-${skillId}-${boxId}`,
    queueName: DEPLOY_QUEUES.installSkill,
    data: {
      boxId,
      deploymentAttempt,
      spriteName,
      skillId,
    },
    opts: {
      attempts: WORKER_CONFIG.installSkill.attempts,
      backoff: WORKER_CONFIG.installSkill.backoff,
      jobId: `${boxId}-${deploymentAttempt}-skill-${skillId}`,
      failParentOnFailure: false, // Allow partial skill failures
    },
  }));

  return {
    name: `skills-gate-${boxId}`,
    queueName: DEPLOY_QUEUES.skillsGate,
    data: { boxId, deploymentAttempt, spriteName, spriteUrl },
    opts: {
      jobId: `${boxId}-${deploymentAttempt}-skills-gate`,
    },
    children: skillJobs,
  };
}
