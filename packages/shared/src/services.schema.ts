import { z } from "zod";

export const ENVIRONMENTS = ["dev", "prod", "local"] as const;

export const Environment = z.enum(ENVIRONMENTS);
export type Environment = z.infer<typeof Environment>;

export const SERVICE_URLS: Record<
  Environment,
  {
    auth: string;
    authInternal: string;
    api: string;
    apiInternal: string;
    web: string;
    boxAgent: string;
    emailFrom: string;
    agentsDomain: string;
    sshBastion: string;
    cookieDomain: string;
  }
> = {
  dev: {
    auth: "http://localhost:33000",
    authInternal: "http://localhost:33000/api/auth",
    api: "http://localhost:33000",
    apiInternal: "http://localhost:33000",
    web: "http://localhost:33001",
    boxAgent: "http://localhost:9999",
    emailFrom: "VPS Claude <agent@inbnd.dev>",
    agentsDomain: "yoda.fun",
    sshBastion: "https://ssh.claude-vps.grm.wtf",
    cookieDomain: "localhost",
  },
  local: {
    auth: "http://api.localhost:33000",
    authInternal: "http://api.localhost:33000/api/auth",
    api: "http://api.localhost:33000",
    apiInternal: "http://api.localhost:33000",
    web: "http://app.localhost:33001",
    boxAgent: "http://boxagent.localhost:9999",
    emailFrom: "VPS Claude <agent@inbnd.dev>",
    agentsDomain: "agents.localhost",
    sshBastion: "http://ssh.localhost:2222",
    cookieDomain: "localhost",
  },
  prod: {
    auth: "https://api.claude-vps.grm.wtf",
    authInternal: "http://api.internal:33000/api/auth",
    api: "https://api.claude-vps.grm.wtf",
    apiInternal: "http://api.internal:33000",
    web: "https://claude-vps.grm.wtf",
    boxAgent: "",
    emailFrom: "VPS Claude <agent@inbnd.dev>",
    agentsDomain: "agents.claude-vps.grm.wtf",
    sshBastion: "https://ssh.claude-vps.grm.wtf",
    cookieDomain: ".claude-vps.grm.wtf",
  },
} as const;
