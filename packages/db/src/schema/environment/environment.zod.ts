import { createSelectSchema, createInsertSchema } from "drizzle-zod";
import { z } from "zod";

import { environment, environmentStatusEnum } from "./environment.db";

export const EnvironmentSelectSchema = createSelectSchema(environment);
export const EnvironmentInsertSchema = createInsertSchema(environment, {
  name: z.string().min(1).max(50),
  subdomain: z.string().min(1).max(100),
});

export const ENVIRONMENT_STATUSES = environmentStatusEnum.enumValues;
export const EnvironmentStatus = z.enum(ENVIRONMENT_STATUSES);
export type EnvironmentStatus = z.infer<typeof EnvironmentStatus>;
