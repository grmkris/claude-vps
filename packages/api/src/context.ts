import type { Auth } from "@vps-claude/auth";
import type { SpritesClient } from "@vps-claude/sprites";
import type { Context as HonoContext } from "hono";

import { UserId } from "@vps-claude/shared";

import type { ApiKeyService } from "./services/api-key.service";
import type { BoxService } from "./services/box.service";
import type { EmailService } from "./services/email.service";
import type { SecretService } from "./services/secret.service";
import type { SkillService } from "./services/skill.service";

export interface Services {
  apiKeyService: ApiKeyService;
  boxService: BoxService;
  emailService: EmailService;
  secretService: SecretService;
  skillService: SkillService;
  spritesClient: SpritesClient;
}

export interface ApiConfig {
  agentsDomain: string;
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
    authorizationHeader: context.req.header("Authorization"),
    boxToken: context.req.header("X-Box-Secret"),
    ...services,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
