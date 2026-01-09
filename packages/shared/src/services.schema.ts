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
    coolify: "https://c.grm.wtf/api/v1";
    agentsDomain: string;
    sshBastion: string;
  }
> = {
  dev: {
    auth: "http://localhost:33000",
    api: "http://localhost:33000",
    web: "http://localhost:33001",
    emailFrom: "VPS Claude <agent@inbnd.dev>",
    coolify: "https://c.grm.wtf/api/v1",
    agentsDomain: "agents.grm.wtf",
    sshBastion: "http://localhost:33002",
  },
  prod: {
    auth: "https://api.claude-vps.grm.wtf",
    api: "https://api.claude-vps.grm.wtf",
    web: "https://claude-vps.grm.wtf",
    emailFrom: "VPS Claude <agent@inbnd.dev>",
    coolify: "https://c.grm.wtf/api/v1",
    agentsDomain: "agents.grm.wtf",
    sshBastion: "https://ssh.claude-vps.grm.wtf",
  },
} as const;
