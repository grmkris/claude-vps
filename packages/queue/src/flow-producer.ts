import type { Redis } from "@vps-claude/redis";

import { FlowProducer, type FlowJob } from "bullmq";

export interface FlowProducerConfig {
  redis: Redis;
}

/**
 * Create a BullMQ FlowProducer for building job DAGs
 *
 * FlowProducer allows creating parent-child job dependencies where:
 * - Children must complete before parent processes
 * - Parent can access child results
 * - Each job in the flow retries independently
 */
export function createFlowProducer(config: FlowProducerConfig) {
  const { redis } = config;

  const flowProducer = new FlowProducer({ connection: redis });

  return {
    flowProducer,

    /**
     * Add a flow (DAG) of jobs
     * Jobs execute from leaves to root - children complete before parents process
     */
    async addFlow(flow: FlowJob): Promise<{ job: { id: string } }> {
      const result = await flowProducer.add(flow);
      return { job: { id: result.job.id ?? "" } };
    },

    /**
     * Add multiple independent flows in bulk
     */
    async addBulkFlows(
      flows: FlowJob[]
    ): Promise<Array<{ job: { id: string } }>> {
      const results = await flowProducer.addBulk(flows);
      return results.map((r) => ({ job: { id: r.job.id ?? "" } }));
    },

    async close(): Promise<void> {
      await flowProducer.close();
    },
  };
}

export type FlowProducerClient = ReturnType<typeof createFlowProducer>;

// Re-export FlowJob type for convenience
export type { FlowJob } from "bullmq";
