import type { Database } from "@vps-claude/db";

import * as schema from "@vps-claude/db/schema/auth/auth.db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

export interface AuthConfig {
  db: Database;
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
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
    advanced: {
      database: {
        generateId: false,
      },
      defaultCookieAttributes: {
        sameSite: "none",
        secure: true,
        httpOnly: true,
      },
    },
  });
};

export type Auth = ReturnType<typeof createAuth>;
