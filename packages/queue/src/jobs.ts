import { z } from "zod";

export const DeployBoxJobData = z.object({
  boxId: z.string(),
  subdomain: z.string(),
  password: z.string(),
});

export type DeployBoxJobData = z.infer<typeof DeployBoxJobData>;

export const DeleteBoxJobData = z.object({
  boxId: z.string(),
  coolifyApplicationUuid: z.string(),
});

export type DeleteBoxJobData = z.infer<typeof DeleteBoxJobData>;
