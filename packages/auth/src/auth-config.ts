import type { Database } from "@vps-claude/db";
import type { EmailClient } from "@vps-claude/email";

import * as schema from "@vps-claude/db/schema/auth/auth.db";
import {
  type Environment,
  SERVICE_URLS,
} from "@vps-claude/shared/services.schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { apiKey, emailOTP } from "better-auth/plugins";

// API Key permission types
export const API_KEY_PERMISSIONS = {
  box: ["create", "read", "delete", "deploy"],
  secret: ["read", "create", "delete"],
  skill: ["read", "create", "delete"],
} as const;

export type ApiKeyPermissions = {
  box?: (typeof API_KEY_PERMISSIONS.box)[number][];
  secret?: (typeof API_KEY_PERMISSIONS.secret)[number][];
  skill?: (typeof API_KEY_PERMISSIONS.skill)[number][];
};

export interface AuthConfig {
  db: Database;
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
  emailClient: EmailClient;
  appEnv: Environment;
}

export const createAuth = (config: AuthConfig) => {
  return betterAuth({
    database: drizzleAdapter(config.db, {
      provider: "pg",
      schema,
    }),
    secret: config.secret,
    baseURL: config.baseURL,
    trustedOrigins: config.trustedOrigins,
    emailAndPassword: {
      enabled: true,
    },
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60, // 5 minutes - avoids DB call on every getSession()
      },
    },
    advanced: {
      database: {
        generateId: false,
      },
      defaultCookieAttributes: {
        sameSite: "none",
        secure: true,
        httpOnly: true,
      },
      crossSubDomainCookies: {
        enabled: true,
        domain: SERVICE_URLS[config.appEnv].cookieDomain,
      },
    },
    plugins: [
      emailOTP({
        sendVerificationOTP: async (data) => {
          const baseUrl = SERVICE_URLS[config.appEnv].web;
          switch (data.type) {
            case "sign-in":
              await config.emailClient.sendEmail({
                type: "sign-in-otp",
                to: data.email,
                otp: data.otp,
                userEmail: data.email,
                baseUrl,
              });
              break;
            case "email-verification":
              await config.emailClient.sendEmail({
                type: "email-verification-otp",
                to: data.email,
                otp: data.otp,
                userEmail: data.email,
                baseUrl,
              });
              break;
            case "forget-password":
              await config.emailClient.sendEmail({
                type: "forget-password-otp",
                to: data.email,
                otp: data.otp,
                userEmail: data.email,
                baseUrl,
              });
              break;
            default:
              throw new Error(`Unknown email type`);
          }
        },
      }),
      apiKey({
        defaultPrefix: "yoda_",
        defaultKeyLength: 32,
        enableSessionForAPIKeys: true,
        enableMetadata: true,
        apiKeyHeaders: ["x-api-key"],
        rateLimit: {
          enabled: true,
          timeWindow: 60 * 1000, // 1 minute
          maxRequests: 100,
        },
        permissions: {
          defaultPermissions: {
            box: ["read"],
            secret: ["read"],
            skill: ["read"],
          },
        },
      }),
    ],
  });
};

export type Auth = ReturnType<typeof createAuth>;
