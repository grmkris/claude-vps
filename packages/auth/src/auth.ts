import { PGlite } from "@electric-sql/pglite";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/pglite";

// Schema generation only: npx @better-auth/cli generate --config ./src/auth.ts -y
export const auth = betterAuth({
  database: drizzleAdapter(drizzle(new PGlite()), {
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
