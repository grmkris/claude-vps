import type { Auth } from "@vps-claude/auth";
import type { SpritesClient } from "@vps-claude/sprites";
import type { Context as HonoContext } from "hono";

import { UserId } from "@vps-claude/shared";

import type { AiService } from "./services/ai.service";
import type { ApiKeyService } from "./services/api-key.service";
import type { BoxService } from "./services/box.service";
import type { DeployStepService } from "./services/deploy-step.service";
import type { EmailService } from "./services/email.service";
import type { SecretService } from "./services/secret.service";

export interface Services {
  aiService: AiService;
  apiKeyService: ApiKeyService;
  boxService: BoxService;
  deployStepService: DeployStepService;
  emailService: EmailService;
  secretService: SecretService;
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
