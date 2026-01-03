import { PGlite } from "@electric-sql/pglite";
import { drizzlePglite } from "@vps-claude/db/drizzle";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

// Schema generation only: npx @better-auth/cli generate --config ./src/auth.ts -y
export const auth = betterAuth({
  database: drizzleAdapter(drizzlePglite(new PGlite()), {
    provider: "pg",
  }),
  emailAndPassword: {
    enabled: true,
  },
  advanced: {
    database: {
      generateId: false,
    },
  },
});
