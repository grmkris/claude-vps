import { z } from "zod";

export const ENVIRONMENTS = ["dev", "prod"] as const;

export const Environment = z.enum(ENVIRONMENTS);
export type Environment = z.infer<typeof Environment>;

export const SERVICE_URLS: Record<
  Environment,
  {
    auth: string;
    api: string;
    web: string;
    emailFrom: string;
    coolify: 'https://c.grm.wtf/api/v1';
  }
> = {
  dev: {
    auth: "http://localhost:33000",
    api: "http://localhost:33000",
    web: "http://localhost:33001",
    emailFrom: "VPS Claude <agent@inbnd.dev>",
    coolify: "https://c.grm.wtf/api/v1",
  },
  prod: {
    auth: "https://api.vps.grm.wtf",
    api: "https://api.vps.grm.wtf",
    web: "https://vps.grm.wtf",
    emailFrom: "VPS Claude <agent@inbnd.dev>",
    coolify: "https://c.grm.wtf/api/v1",
  },
} as const;
