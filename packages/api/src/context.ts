import type { Auth } from "@vps-claude/auth";
import type { WideEvent } from "@vps-claude/logger";
import type { ProviderFactory } from "@vps-claude/providers";
import type { SpritesClient } from "@vps-claude/sprites";
import type { Context as HonoContext } from "hono";

import { UserId } from "@vps-claude/shared";

import type { AgentInboxService } from "./services/agent-inbox.service";
import type { AiService } from "./services/ai.service";
import type { ApiKeyService } from "./services/api-key.service";
import type { BoxEnvVarService } from "./services/box-env-var.service";
import type { BoxService } from "./services/box.service";
import type { CredentialService } from "./services/credential.service";
import type { CronjobService } from "./services/cronjob.service";
import type { DeployStepService } from "./services/deploy-step.service";
import type { EmailService } from "./services/email.service";

export interface Services {
  agentInboxService: AgentInboxService;
  aiService: AiService;
  apiKeyService: ApiKeyService;
  boxEnvVarService: BoxEnvVarService;
  boxService: BoxService;
  credentialService: CredentialService;
  cronjobService: CronjobService;
  deployStepService: DeployStepService;
  emailService: EmailService;
  providerFactory: ProviderFactory;
  /** @deprecated Use providerFactory instead */
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
    wideEvent: context.get?.("wideEvent") as WideEvent | undefined,
    authorizationHeader: context.req.header("Authorization"),
    boxToken: context.req.header("X-Box-Secret"),
    ...services,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
