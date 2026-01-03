import { getRedis } from "@vps-claude/redis";
import { WORKER_CONFIG } from "@vps-claude/shared";
import { Queue } from "bullmq";

import type { DeployBoxJobData, DeleteBoxJobData } from "./jobs";

export type { DeployBoxJobData, DeleteBoxJobData };
export { DeployBoxJobData as DeployBoxJobDataSchema } from "./jobs";
export { DeleteBoxJobData as DeleteBoxJobDataSchema } from "./jobs";

let deployQueueInstance: Queue<DeployBoxJobData> | null = null;
let deleteQueueInstance: Queue<DeleteBoxJobData> | null = null;

export function getDeployQueue(): Queue<DeployBoxJobData> {
  if (!deployQueueInstance) {
    deployQueueInstance = new Queue<DeployBoxJobData>(
      WORKER_CONFIG.deployBox.name,
      {
        connection: getRedis(),
      }
    );
  }
  return deployQueueInstance;
}

export function getDeleteQueue(): Queue<DeleteBoxJobData> {
  if (!deleteQueueInstance) {
    deleteQueueInstance = new Queue<DeleteBoxJobData>(
      WORKER_CONFIG.deleteBox.name,
      {
        connection: getRedis(),
      }
    );
  }
  return deleteQueueInstance;
}

export async function closeQueues(): Promise<void> {
  if (deployQueueInstance) {
    await deployQueueInstance.close();
    deployQueueInstance = null;
  }
  if (deleteQueueInstance) {
    await deleteQueueInstance.close();
    deleteQueueInstance = null;
  }
}

export { Queue, Worker, Job } from "bullmq";
