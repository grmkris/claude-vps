import { z } from "zod";

export const DeployEnvironmentJobData = z.object({
  environmentId: z.string(),
  subdomain: z.string(),
  password: z.string(),
});

export type DeployEnvironmentJobData = z.infer<typeof DeployEnvironmentJobData>;

export const DeleteEnvironmentJobData = z.object({
  environmentId: z.string(),
  coolifyApplicationUuid: z.string(),
});

export type DeleteEnvironmentJobData = z.infer<typeof DeleteEnvironmentJobData>;
