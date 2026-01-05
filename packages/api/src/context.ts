import type { Auth } from "@vps-claude/auth";
import type { Context as HonoContext } from "hono";

import { UserId } from "@vps-claude/shared";

import type { BoxService } from "./services/box.service";
import type { EmailService } from "./services/email.service";
import type { SecretService } from "./services/secret.service";
import type { SkillService } from "./services/skill.service";

export interface Services {
  boxService: BoxService;
  emailService: EmailService;
  secretService: SecretService;
  skillService: SkillService;
}

export interface ApiConfig {
  agentsDomain: string;
  internalApiKey: string;
}

export type CreateContextOptions = {
  context: HonoContext;
  services: Services;
  auth: Auth;
  config: ApiConfig;
};

export async function createContext({
  context,
  services,
  auth,
  config,
}: CreateContextOptions) {
  const session = await auth.api.getSession({
    headers: context.req.raw.headers,
  });
  const typedSession = session
    ? {
        ...session,
        user: {
          ...session.user,
          id: UserId.optional().parse(session.user.id),
        },
      }
    : null;
  return {
    session: typedSession,
    config,
    internalApiKey: config.internalApiKey,
    authorizationHeader: context.req.header("Authorization"),
    boxToken: undefined as string | undefined, // Added by boxProcedure middleware
    ...services,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
