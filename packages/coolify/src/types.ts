import { z } from "zod";

export const CoolifyApplicationStatus = z.enum([
  "running",
  "stopped",
  "starting",
  "stopping",
  "error",
  "degraded",
  "exited",
]);

export type CoolifyApplicationStatus = z.infer<typeof CoolifyApplicationStatus>;

export const CoolifyApplication = z.object({
  uuid: z.string(),
  name: z.string(),
  fqdn: z.string().nullable(),
  status: z.string().nullable(),
});

export type CoolifyApplication = z.infer<typeof CoolifyApplication>;

export const CreateApplicationResponse = z.object({
  uuid: z.string(),
  domains: z.array(z.string()).optional(),
});

export type CreateApplicationResponse = z.infer<
  typeof CreateApplicationResponse
>;
