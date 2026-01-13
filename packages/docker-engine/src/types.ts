import { z } from "zod";

export const CreateBoxConfigSchema = z.object({
  userId: z.string(),
  boxId: z.string(),
  subdomain: z.string(),
  name: z.string(),
  image: z.string(),
  envVars: z.record(z.string(), z.string().optional()),
  exposedPorts: z.array(z.number()).optional().default([]),
});

export type CreateBoxConfig = z.infer<typeof CreateBoxConfigSchema>;

export type BoxContainer = {
  id: string;
  name: string;
  subdomain: string;
  status: "running" | "stopped";
  ipAddress?: string;
};

export type BoxStats = {
  cpuPercent: number;
  memoryUsageMB: number;
  memoryLimitMB: number;
  memoryPercent: number;
  networkRxBytes: number;
  networkTxBytes: number;
};
