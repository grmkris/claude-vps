import { getRedis } from "@vps-claude/redis";
import { WORKER_CONFIG } from "@vps-claude/shared";
import { Queue } from "bullmq";

import type { DeployEnvironmentJobData, DeleteEnvironmentJobData } from "./jobs";

export type { DeployEnvironmentJobData, DeleteEnvironmentJobData };
export { DeployEnvironmentJobData as DeployEnvironmentJobDataSchema } from "./jobs";
export { DeleteEnvironmentJobData as DeleteEnvironmentJobDataSchema } from "./jobs";

let deployQueueInstance: Queue<DeployEnvironmentJobData> | null = null;
let deleteQueueInstance: Queue<DeleteEnvironmentJobData> | null = null;

export function getDeployQueue(): Queue<DeployEnvironmentJobData> {
  if (!deployQueueInstance) {
    deployQueueInstance = new Queue<DeployEnvironmentJobData>(
      WORKER_CONFIG.deployEnvironment.name,
      {
        connection: getRedis(),
      },
    );
  }
  return deployQueueInstance;
}

export function getDeleteQueue(): Queue<DeleteEnvironmentJobData> {
  if (!deleteQueueInstance) {
    deleteQueueInstance = new Queue<DeleteEnvironmentJobData>(
      WORKER_CONFIG.deleteEnvironment.name,
      {
        connection: getRedis(),
      },
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
