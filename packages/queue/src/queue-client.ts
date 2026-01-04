import type { Redis } from "@vps-claude/redis";

import { WORKER_CONFIG } from "@vps-claude/shared";
import { Queue } from "bullmq";

import type { DeployBoxJobData, DeleteBoxJobData } from "./jobs";

export type { DeployBoxJobData, DeleteBoxJobData };
export { DeployBoxJobData as DeployBoxJobDataSchema } from "./jobs";
export { DeleteBoxJobData as DeleteBoxJobDataSchema } from "./jobs";

export interface QueueClientConfig {
  redis: Redis;
}

export function createQueueClient(config: QueueClientConfig) {
  const { redis } = config;

  const deployQueue = new Queue<DeployBoxJobData>(
    WORKER_CONFIG.deployBox.name,
    { connection: redis }
  );

  const deleteQueue = new Queue<DeleteBoxJobData>(
    WORKER_CONFIG.deleteBox.name,
    { connection: redis }
  );

  return {
    deployQueue,
    deleteQueue,
    async close() {
      await deployQueue.close();
      await deleteQueue.close();
    },
  };
}

export type QueueClient = ReturnType<typeof createQueueClient>;

export { Queue, Worker, Job } from "bullmq";
