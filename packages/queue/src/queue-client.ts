import type { Redis } from "@vps-claude/redis";

import { WORKER_CONFIG } from "@vps-claude/shared";
import { Queue } from "bullmq";

import type {
  DeployBoxJobData,
  DeleteBoxJobData,
  DeliverEmailJobData,
  SendEmailJobData,
} from "./jobs";

export type {
  DeployBoxJobData,
  DeleteBoxJobData,
  DeliverEmailJobData,
  SendEmailJobData,
};
export { DeployBoxJobData as DeployBoxJobDataSchema } from "./jobs";
export { DeleteBoxJobData as DeleteBoxJobDataSchema } from "./jobs";
export { DeliverEmailJobData as DeliverEmailJobDataSchema } from "./jobs";
export { SendEmailJobData as SendEmailJobDataSchema } from "./jobs";

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

  const deliverEmailQueue = new Queue<DeliverEmailJobData>(
    WORKER_CONFIG.deliverEmail.name,
    { connection: redis }
  );

  const sendEmailQueue = new Queue<SendEmailJobData>(
    WORKER_CONFIG.sendEmail.name,
    { connection: redis }
  );

  return {
    deployQueue,
    deleteQueue,
    deliverEmailQueue,
    sendEmailQueue,
    async close() {
      await deployQueue.close();
      await deleteQueue.close();
      await deliverEmailQueue.close();
      await sendEmailQueue.close();
    },
  };
}

export type QueueClient = ReturnType<typeof createQueueClient>;

export { Queue, Worker, Job } from "bullmq";
