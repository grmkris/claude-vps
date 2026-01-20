export { createClient, type SDKConfig } from "./client";
export {
  createAuthHelper,
  signIn,
  createApiKey,
  type AuthClient,
  type SignInResult,
  type CreateApiKeyOptions,
  type CreateApiKeyResult,
} from "./auth";
export type { AppRouterClient } from "@vps-claude/api/routers/index";
