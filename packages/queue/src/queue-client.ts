import type { Redis } from "@vps-claude/redis";

import { WORKER_CONFIG } from "@vps-claude/shared";
import { Queue, FlowProducer } from "bullmq";

import type {
  DeployBoxJobData,
  DeleteBoxJobData,
  DeliverEmailJobData,
  SendEmailJobData,
  TriggerCronjobJobData,
} from "./jobs";

import {
  DEPLOY_QUEUES,
  type DeployOrchestratorJobData,
  type CreateSpriteJobData,
  type SetupStepJobData,
  type HealthCheckJobData,
  type InstallSkillJobData,
  type EnableAccessJobData,
  type FinalizeJobData,
  type SkillsGateJobData,
} from "./deploy-flow-jobs";

export type {
  DeployBoxJobData,
  DeleteBoxJobData,
  DeliverEmailJobData,
  SendEmailJobData,
  TriggerCronjobJobData,
};
export { DeployBoxJobData as DeployBoxJobDataSchema } from "./jobs";
export { DeleteBoxJobData as DeleteBoxJobDataSchema } from "./jobs";
export { DeliverEmailJobData as DeliverEmailJobDataSchema } from "./jobs";
export { SendEmailJobData as SendEmailJobDataSchema } from "./jobs";
export { TriggerCronjobJobData as TriggerCronjobJobDataSchema } from "./jobs";

export interface QueueClientConfig {
  redis: Redis;
}

export function createQueueClient(config: QueueClientConfig) {
  const { redis } = config;

  // Legacy deploy queue (will be deprecated)
  const deployQueue = new Queue<DeployBoxJobData>(
    WORKER_CONFIG.deployBox.name,
    { connection: redis }
  );

  const deleteQueue = new Queue<DeleteBoxJobData>(
    WORKER_CONFIG.deleteBox.name,
    { connection: redis }
  );

  const deliverEmailQueue = new Queue<DeliverEmailJobData>(
    WORKER_CONFIG.deliverEmail.name,
    { connection: redis }
  );

  const sendEmailQueue = new Queue<SendEmailJobData>(
    WORKER_CONFIG.sendEmail.name,
    { connection: redis }
  );

  const triggerCronjobQueue = new Queue<TriggerCronjobJobData>(
    WORKER_CONFIG.triggerCronjob.name,
    { connection: redis }
  );

  // Deploy flow queues (modular workers)
  const deployOrchestratorQueue = new Queue<DeployOrchestratorJobData>(
    DEPLOY_QUEUES.orchestrator,
    { connection: redis }
  );

  const createSpriteQueue = new Queue<CreateSpriteJobData>(
    DEPLOY_QUEUES.createSprite,
    { connection: redis }
  );

  const setupStepQueue = new Queue<SetupStepJobData>(DEPLOY_QUEUES.setupStep, {
    connection: redis,
  });

  const healthCheckQueue = new Queue<HealthCheckJobData>(
    DEPLOY_QUEUES.healthCheck,
    { connection: redis }
  );

  const installSkillQueue = new Queue<InstallSkillJobData>(
    DEPLOY_QUEUES.installSkill,
    { connection: redis }
  );

  const enableAccessQueue = new Queue<EnableAccessJobData>(
    DEPLOY_QUEUES.enableAccess,
    { connection: redis }
  );

  const finalizeQueue = new Queue<FinalizeJobData>(DEPLOY_QUEUES.finalize, {
    connection: redis,
  });

  const skillsGateQueue = new Queue<SkillsGateJobData>(
    DEPLOY_QUEUES.skillsGate,
    { connection: redis }
  );

  // FlowProducer for creating job DAGs
  const flowProducer = new FlowProducer({ connection: redis });

  return {
    // Legacy queues
    deployQueue,
    deleteQueue,
    deliverEmailQueue,
    sendEmailQueue,
    triggerCronjobQueue,

    // Deploy flow queues
    deployOrchestratorQueue,
    createSpriteQueue,
    setupStepQueue,
    healthCheckQueue,
    installSkillQueue,
    enableAccessQueue,
    finalizeQueue,
    skillsGateQueue,

    // FlowProducer for DAG creation
    flowProducer,

    async close() {
      await deployQueue.close();
      await deleteQueue.close();
      await deliverEmailQueue.close();
      await sendEmailQueue.close();
      await triggerCronjobQueue.close();
      await deployOrchestratorQueue.close();
      await createSpriteQueue.close();
      await setupStepQueue.close();
      await healthCheckQueue.close();
      await installSkillQueue.close();
      await enableAccessQueue.close();
      await finalizeQueue.close();
      await skillsGateQueue.close();
      await flowProducer.close();
    },
  };
}

export type QueueClient = ReturnType<typeof createQueueClient>;

export { Queue, Worker, Job, FlowProducer, type FlowJob } from "bullmq";

// Re-export deploy flow job types
export {
  DEPLOY_QUEUES,
  type DeployOrchestratorJobData,
  type CreateSpriteJobData,
  type SetupStepJobData,
  type HealthCheckJobData,
  type InstallSkillJobData,
  type EnableAccessJobData,
  type FinalizeJobData,
  type SkillsGateJobData,
  type DeployJobResult,
} from "./deploy-flow-jobs";
export {
  DeployOrchestratorJobData as DeployOrchestratorJobDataSchema,
  CreateSpriteJobData as CreateSpriteJobDataSchema,
  SetupStepJobData as SetupStepJobDataSchema,
  HealthCheckJobData as HealthCheckJobDataSchema,
  InstallSkillJobData as InstallSkillJobDataSchema,
  EnableAccessJobData as EnableAccessJobDataSchema,
  FinalizeJobData as FinalizeJobDataSchema,
  SkillsGateJobData as SkillsGateJobDataSchema,
} from "./deploy-flow-jobs";
